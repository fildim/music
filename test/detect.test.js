import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectKey, rankKeys, triadQuality } from '../src/detect.js';
import { parseChord } from '../src/chords.js';
import { keyLabel, keyName, makeKey } from '../src/theory.js';

const chords = (...syms) => syms.map(parseChord);

test('common progressions land on the right key', () => {
  const cases = [
    [['E', 'A', 'E', 'B7', 'E', 'C#m', 'A', 'B7', 'E'], 'E major'],
    [['C', 'G', 'Am', 'F', 'C', 'F', 'G', 'C'], 'C major'],
    [['Am', 'F', 'C', 'G', 'Am', 'Dm', 'E7', 'Am'], 'A minor'],
    [['G', 'C', 'D', 'G', 'Em', 'C', 'D', 'G'], 'G major'],
    [['Bb', 'Eb', 'F', 'Bb', 'Gm', 'Cm', 'F7', 'Bb'], 'Bb major'],
    [['F#m', 'D', 'A', 'E', 'F#m', 'Bm', 'C#7', 'F#m'], 'F# minor'],
    [['D', 'G', 'A', 'D', 'Bm', 'G', 'A', 'D'], 'D major'],
    [['Eb', 'Ab', 'Bb', 'Eb', 'Cm', 'Fm', 'Bb7', 'Eb'], 'Eb major'],
  ];
  for (const [syms, expected] of cases) {
    assert.equal(keyLabel(detectKey(chords(...syms)).key), expected);
  }
});

test('flat keys are named with flats, not with ten sharps', () => {
  assert.equal(keyName(detectKey(chords('Bb', 'Eb', 'F', 'Bb')).key), 'Bb');
  assert.equal(keyName(detectKey(chords('Ab', 'Db', 'Eb', 'Ab')).key), 'Ab');
});

test('a declared key beats detection', () => {
  const result = detectKey(chords('C', 'F', 'G'), makeKey('A', 'minor'));
  assert.equal(keyName(result.key), 'Am');
  assert.equal(result.source, 'declared');
});

test('enharmonic twins do not compete and zero out confidence', () => {
  const ranked = rankKeys(chords('F#m', 'D', 'A', 'E', 'F#m'));
  const names = ranked.slice(0, 4).map((r) => keyName(r.key));
  assert.equal(new Set(names).size, names.length, 'no duplicate-sounding keys in the ranking');
  assert.ok(ranked[0].confidence > 0);
});

test('empty input is handled', () => {
  assert.equal(detectKey([]), null);
  assert.deepEqual(rankKeys([]), []);
});

test('triad quality is read from the chord suffix', () => {
  assert.equal(triadQuality(parseChord('C')), 'maj');
  assert.equal(triadQuality(parseChord('Cm7')), 'min');
  assert.equal(triadQuality(parseChord('Cmaj7')), 'maj');
  assert.equal(triadQuality(parseChord('Cdim')), 'dim');
  assert.equal(triadQuality(parseChord('C+')), 'aug');
  assert.equal(triadQuality(parseChord('Csus4')), 'sus');
  assert.equal(triadQuality(parseChord('Cm7b5')), 'dim');
});
