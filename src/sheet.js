/**
 * Chord-sheet parsing and transposition.
 *
 * Handles the two formats people actually have:
 *   1. ChordPro / inline brackets:  "I [C]once was [G]lost"
 *   2. Chords on their own line above the lyric line:
 *          C           G
 *          I once was lost
 *
 * Format 2 is where transposition usually goes wrong. Chord names change
 * WIDTH (A -> Bb), so a naive replace slides every later chord off the syllable
 * it belongs to. Each chord is re-anchored to its original column instead, and
 * only pushed right when the previous chord genuinely overruns it.
 */

import { parseChord, formatChord, transposeChord, isMarker, chordToNashville } from './chords.js';
import { parseKey, keyName } from './theory.js';

const DIRECTIVE_RE = /^\s*\{\s*([^:}]+?)\s*(?::\s*([\s\S]*?))?\s*\}\s*$/;
const START_TAB = /^(start_of_tab|sot)$/i;
const END_TAB = /^(end_of_tab|eot)$/i;
const KEY_DIRECTIVE = /^(key|k)$/i;
// A run of 3+ dashes next to a bar line is guitar tablature, not a chord line.
const TAB_LINE_RE = /-{3,}/;
const BRACKET_RE = /\[([^\][]*)\]/g;
// Token wrappers that appear around chords in real sheets: (C)  C7,  [G]
const WRAP_RE = /^([([{]*)([\s\S]*?)([)\]}]*[,.;]?)$/;

export function expandTabs(text, width = 8) {
  return text.split('\n').map((line) => {
    if (!line.includes('\t')) return line;
    let out = '';
    for (const ch of line) {
      if (ch === '\t') out += ' '.repeat(width - (out.length % width));
      else out += ch;
    }
    return out;
  }).join('\n');
}

function tokenize(line) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const raw = m[0];
    const wrap = WRAP_RE.exec(raw);
    tokens.push({
      raw,
      core: wrap[2],
      prefix: wrap[1],
      suffix: wrap[3],
      start: m.index,
      end: m.index + raw.length,
      chord: parseChord(wrap[2]),
    });
  }
  return tokens;
}

function classifyPlainLine(line) {
  if (line.trim() === '') return { type: 'blank' };
  if (TAB_LINE_RE.test(line) && /[|:]/.test(line)) return { type: 'tab' };

  const tokens = tokenize(line);
  const chords = tokens.filter((t) => t.chord);
  const markers = tokens.filter((t) => !t.chord && isMarker(t.core));
  if (chords.length === 0) return { type: 'lyric' };
  if (chords.length + markers.length !== tokens.length) return { type: 'lyric' };

  // "Go" parses as G-diminished. A line whose only chords are weak readings is
  // treated as a lyric unless there are several of them.
  const strong = chords.filter((t) => !t.chord.weak);
  if (strong.length === 0 && chords.length < 2) return { type: 'lyric' };

  return { type: 'chords', tokens };
}

/**
 * Split the text into classified lines. `overrides` maps a line index to a
 * forced type ('chords' or 'lyric'), so a wrong guess is always correctable
 * from the UI rather than being silently baked in.
 */
export function analyzeSheet(rawText, overrides = {}) {
  const hadTabs = rawText.includes('\t');
  const text = hadTabs ? expandTabs(rawText) : rawText;
  const lines = [];
  const chords = [];
  const warnings = [];
  let inTabBlock = false;
  let sawTab = false;
  let bracketCount = 0;
  let declaredKey = null;

  text.split('\n').forEach((raw, index) => {
    const directive = DIRECTIVE_RE.exec(raw);
    if (directive) {
      const name = directive[1];
      if (START_TAB.test(name)) inTabBlock = true;
      if (END_TAB.test(name)) inTabBlock = false;
      if (KEY_DIRECTIVE.test(name) && directive[2]) {
        const parsed = parseKey(directive[2]);
        if (parsed) declaredKey = parsed;
      }
      lines.push({ index, raw, type: 'directive', name, value: directive[2] ?? null });
      return;
    }

    if (inTabBlock) {
      sawTab = true;
      lines.push({ index, raw, type: 'tab' });
      return;
    }

    // Inline brackets win: they are unambiguous, so no guessing is needed.
    const brackets = [];
    BRACKET_RE.lastIndex = 0;
    let m;
    while ((m = BRACKET_RE.exec(raw)) !== null) {
      const chord = parseChord(m[1].trim());
      brackets.push({ start: m.index, end: m.index + m[0].length, inner: m[1], chord });
      if (chord) chords.push(chord);
    }
    if (brackets.some((b) => b.chord)) {
      bracketCount += brackets.filter((b) => b.chord).length;
      lines.push({ index, raw, type: 'chordpro', brackets });
      return;
    }

    const forced = overrides[index];
    let result = classifyPlainLine(raw);
    if (forced === 'lyric' && result.type === 'chords') result = { type: 'lyric' };
    if (forced === 'chords' && (result.type === 'lyric' || result.type === 'tab')) {
      result = { type: 'chords', tokens: tokenize(raw) };
    }
    if (result.type === 'tab') sawTab = true;
    if (result.type === 'chords') {
      for (const t of result.tokens) if (t.chord) chords.push(t.chord);
    }
    lines.push({ index, raw, ...result });
  });

  if (hadTabs) warnings.push('Tab characters were expanded to spaces (8-column stops) so chords stay aligned.');
  if (sawTab) warnings.push('Guitar tablature was left untouched — transposing tab needs re-fingering, not renaming.');

  return {
    lines,
    chords,
    warnings,
    declaredKey,
    format: bracketCount > 0 ? 'chordpro' : 'plain',
  };
}

/**
 * Rebuild a chord line, keeping every chord over the syllable it started on.
 * Chords only move right, and only as far as the previous chord forces them.
 */
function rebuildChordLine(original, replacements) {
  let out = '';
  const segments = [];
  let prevEnd = 0;

  for (const r of replacements) {
    const between = original.slice(prevEnd, r.start);
    let lead = '';
    let core = '';
    let trail = '';
    if (/^\s*$/.test(between)) {
      trail = between;
    } else {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(between);
      [, lead, core, trail] = m;
    }

    const minLead = lead.length ? 1 : 0;
    const minTrail = trail.length ? 1 : 0;
    const minTotal = minLead + core.length + minTrail;
    const total = Math.max(r.start - out.length, minTotal);
    const extra = total - minTotal;

    let leadWidth = minLead;
    let trailWidth = minTrail;
    if (extra > 0) {
      if (lead.length > 0 && lead.length >= trail.length) leadWidth += extra;
      else trailWidth += extra;
    }

    const gap = ' '.repeat(leadWidth) + core + ' '.repeat(trailWidth);
    if (gap) segments.push({ text: gap, kind: 'plain' });
    out += gap;
    segments.push({ text: r.text, kind: r.kind ?? 'chord' });
    out += r.text;
    prevEnd = r.end;
  }

  const tail = original.slice(prevEnd).replace(/\s+$/, '');
  if (tail) {
    segments.push({ text: tail, kind: 'plain' });
    out += tail;
  }
  return { text: out, segments };
}

function renderChordText(chord, t, opts) {
  if (opts.nashville && opts.nashvilleKey) {
    const n = chordToNashville(chord, opts.nashvilleKey);
    if (n !== null) return n;
  }
  return formatChord(transposeChord(chord, t, opts), opts);
}

/**
 * Apply a transposition to an analyzed sheet.
 * Returns the new text plus per-line segments so the UI can highlight chords.
 */
export function transposeSheet(analysis, t, options = {}) {
  const opts = { simplify: true, unicode: false, nashville: false, ...options };
  const outLines = [];

  for (const line of analysis.lines) {
    switch (line.type) {
      case 'directive': {
        if (KEY_DIRECTIVE.test(line.name) && line.value) {
          const parsed = parseKey(line.value);
          if (parsed && t.targetKey) {
            const replaced = line.raw.replace(line.value, keyName(t.targetKey, { unicode: opts.unicode }));
            outLines.push({ type: 'directive', text: replaced, segments: [{ text: replaced, kind: 'directive' }] });
            break;
          }
        }
        outLines.push({ type: 'directive', text: line.raw, segments: [{ text: line.raw, kind: 'directive' }] });
        break;
      }

      case 'chordpro': {
        let text = '';
        const segments = [];
        let cursor = 0;
        for (const b of line.brackets) {
          const before = line.raw.slice(cursor, b.start);
          if (before) { segments.push({ text: before, kind: 'plain' }); text += before; }
          if (b.chord) {
            const inner = renderChordText(b.chord, t, opts);
            segments.push({ text: `[${inner}]`, kind: 'chord' });
            text += `[${inner}]`;
          } else {
            segments.push({ text: line.raw.slice(b.start, b.end), kind: 'plain' });
            text += line.raw.slice(b.start, b.end);
          }
          cursor = b.end;
        }
        const rest = line.raw.slice(cursor);
        if (rest) { segments.push({ text: rest, kind: 'plain' }); text += rest; }
        outLines.push({ type: 'chordpro', text, segments });
        break;
      }

      case 'chords': {
        // Bar lines and rhythm slashes keep their own columns alongside chords.
        const replacements = line.tokens.map((tok) => (tok.chord
          ? {
            start: tok.start,
            end: tok.end,
            kind: 'chord',
            text: tok.prefix + renderChordText(tok.chord, t, opts) + tok.suffix,
          }
          : { start: tok.start, end: tok.end, kind: 'plain', text: tok.raw }));
        const built = rebuildChordLine(line.raw, replacements);
        outLines.push({ type: 'chords', text: built.text, segments: built.segments });
        break;
      }

      default:
        outLines.push({ type: line.type, text: line.raw, segments: [{ text: line.raw, kind: 'plain' }] });
    }
  }

  return { text: outLines.map((l) => l.text).join('\n'), lines: outLines };
}
