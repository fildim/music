import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChord, formatChord, transposeToken, chordToNashville, isMarker } from '../src/chords.js';
import { makeKey, buildTransposition } from '../src/theory.js';

const E_TO_F = buildTransposition(makeKey('E'), makeKey('F'), 1);

test('real chord symbols parse', () => {
  const symbols = [
    'C', 'Am', 'F#m7', 'Bb', 'C#m7b5', 'Gsus4', 'Dmaj7', 'A7sus4', 'Cadd9',
    'Bbmaj7#11', 'E5', 'D/F#', 'Cm(maj7)', 'G13', 'Eaug', 'C+', 'F°', 'Ddim7',
    'Am7/G', 'Gb', 'A#m', 'C6/9', 'Dm9', 'E7b9', 'Bsus', 'Fmaj9', 'Cmin', 'Db',
  ];
  for (const s of symbols) assert.ok(parseChord(s), `${s} should parse`);
});

test('lyric words are not mistaken for chords', () => {
  // A permissive parser reads "Bad" as B-add and rewrites the lyric.
  const words = [
    'Bad', 'Cage', 'Face', 'Amen', 'Golden', 'Around', 'Baby', 'Girl', 'Good',
    'God', 'Dear', 'Down', 'Alone', 'Believe', 'Because', 'Every', 'Fade',
    'Add', 'Aug', 'Chorus', 'Bridge', 'Break', 'Verse', 'Intro', 'End', 'Coda',
    'Bass', 'Boy', 'Days', 'Come', 'Gone', 'Ache', 'Dance', 'Fall', 'Doo',
  ];
  for (const w of words) {
    const parsed = parseChord(w);
    assert.ok(!parsed || parsed.weak, `${w} must not read as a confident chord`);
  }
});

test('ambiguous words parse but are flagged weak', () => {
  assert.equal(parseChord('Do').weak, true);
  assert.equal(parseChord('Go').weak, true);
  assert.equal(parseChord('C°').weak, false, 'the degree sign is unambiguous');
  assert.equal(parseChord('Cdim').weak, false);
});

test('slash chords, and the 6/9 chord that is not one', () => {
  const slash = parseChord('Am7/G');
  assert.equal(slash.quality, 'm7');
  assert.equal(slash.bass.letter, 'G');
  const sixNine = parseChord('C6/9');
  assert.equal(sixNine.bass, null, '6/9 is a quality, not a bass note');
  assert.equal(sixNine.quality, '6/9');
  assert.equal(parseChord('C6/9/E').bass.letter, 'E');
});

test('transposition preserves quality and moves the bass too', () => {
  assert.equal(transposeToken('E', E_TO_F), 'F');
  assert.equal(transposeToken('A', E_TO_F), 'Bb');
  assert.equal(transposeToken('C#m7', E_TO_F), 'Dm7');
  assert.equal(transposeToken('A/C#', E_TO_F), 'Bb/D');
  assert.equal(transposeToken('B7sus4', E_TO_F), 'C7sus4');
  assert.equal(transposeToken('F#m7b5', E_TO_F), 'Gm7b5');
});

test('non-chords pass through transposition untouched', () => {
  assert.equal(transposeToken('Chorus', E_TO_F), 'Chorus');
  assert.equal(transposeToken('|', E_TO_F), '|');
});

test('formatting round trips', () => {
  assert.equal(formatChord(parseChord('F#m7/C#')), 'F#m7/C#');
  assert.equal(formatChord(parseChord('Bb'), { unicode: true }), 'B♭');
});

test('markers on a chord line', () => {
  for (const m of ['|', '||', ':|', '%', '/', 'x2', '(2x)', 'N.C.']) {
    assert.ok(isMarker(m), `${m} should be a marker`);
  }
  assert.ok(!isMarker('hello'));
});

test('nashville numbers use conventional degree spelling', () => {
  const E = makeKey('E');
  assert.equal(chordToNashville(parseChord('E'), E), '1');
  assert.equal(chordToNashville(parseChord('C#m'), E), '6m');
  assert.equal(chordToNashville(parseChord('D'), E), 'b7', 'flat seven, not sharp six');
  assert.equal(chordToNashville(parseChord('A/C#'), E), '4/6');
  const Am = makeKey('A', 'minor');
  assert.equal(chordToNashville(parseChord('C'), Am), 'b3');
  assert.equal(chordToNashville(parseChord('G'), Am), 'b7');
});
