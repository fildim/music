/**
 * Bundle the ES modules into one file, with no dependencies.
 *
 * Each module is wrapped in its own block and its exports are handed to a
 * shared registry, so two modules can both have a private `MAJOR_STEPS`
 * without colliding the way a naive concatenation would.
 *
 * Produces:
 *   dist/index.html    — a standalone page (open it directly, or host it)
 *   dist/artifact.html — the same page as a fragment, for publishing
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const ORDER = ['theory', 'chords', 'sheet', 'detect', 'musicxml', 'midi', 'mxl', 'range', 'app'];

const IMPORT_RE = /import\s+(?:[^;'"]*?)\s+from\s+'[^']+';/g;
const EXPORT_LIST_RE = /^export\s*\{([^}]*)\}\s*;?\s*$/gm;
const EXPORT_DECL_RE = /^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm;

function analyze(source) {
  const imported = new Set();
  for (const match of source.matchAll(IMPORT_RE)) {
    const names = /\{([^}]*)\}/.exec(match[0]);
    if (!names) continue;
    for (const raw of names[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop().trim();
      if (name) imported.add(name);
    }
  }

  const exported = new Set();
  for (const match of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    exported.add(match[1]);
  }
  for (const match of source.matchAll(EXPORT_LIST_RE)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop().trim();
      if (name) exported.add(name);
    }
  }
  return { imported, exported };
}

function bundle() {
  const blocks = [];
  for (const name of ORDER) {
    const source = readFileSync(join(root, 'src', `${name}.js`), 'utf8');
    const { imported, exported } = analyze(source);
    const body = source
      .replace(IMPORT_RE, '')
      .replace(EXPORT_LIST_RE, '')
      .replace(EXPORT_DECL_RE, '');

    const head = imported.size ? `const { ${[...imported].join(', ')} } = __m;\n` : '';
    const tail = exported.size ? `\nObject.assign(__m, { ${[...exported].join(', ')} });\n` : '';
    blocks.push(`/* ---- src/${name}.js ---- */\n{\n${head}${body}${tail}}\n`);
  }
  return `const __m = {};\n${blocks.join('\n')}`;
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'assets', 'styles.css'), 'utf8');
const js = bundle();

const inlined = html
  .replace('<link rel="stylesheet" href="assets/styles.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="src/app.js"></script>', `<script type="module">\n${js}\n</script>`);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), inlined);

// The Artifact host supplies <!doctype>, <html>, <head> and <body> itself.
const fragment = inlined
  .replace(/^[\s\S]*?<head>\s*/, '')
  .replace(/<meta charset[^>]*>\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '')
  .replace(/<\/head>\s*<body>\s*/, '')
  .replace(/\s*<\/body>\s*<\/html>\s*$/, '\n');
writeFileSync(join(root, 'dist', 'artifact.html'), fragment);

console.log(`dist/index.html    ${(inlined.length / 1024).toFixed(1)} KB`);
console.log(`dist/artifact.html ${(fragment.length / 1024).toFixed(1)} KB`);
