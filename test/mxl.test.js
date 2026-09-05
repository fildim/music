import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readMxl, listZipEntries } from '../src/mxl.js';

const buffer = readFileSync(new URL('../examples/sample.mxl', import.meta.url));

test('the zip directory is read', () => {
  const names = listZipEntries(buffer).map((e) => e.name);
  assert.ok(names.includes('META-INF/container.xml'));
  assert.ok(names.includes('score.xml'));
});

test('the score is found through the container manifest', async () => {
  const xml = await readMxl(buffer);
  assert.match(xml, /<fifths>4<\/fifths>/);
  assert.match(xml, /score-partwise/);
});

test('a non-zip file is rejected clearly', async () => {
  await assert.rejects(() => readMxl(Uint8Array.from([1, 2, 3])), /does not look like a \.mxl/);
});
