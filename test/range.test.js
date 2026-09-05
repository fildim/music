import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankShifts, simpleShift, toMidi, describeRange, shiftedKey, VOICE_PRESETS } from '../src/range.js';
import { makeKey, keyName } from '../src/theory.js';

test('note text to midi', () => {
  assert.equal(toMidi('C4'), 60);
  assert.equal(toMidi('g3'), 55);
  assert.equal(toMidi('Bb2'), 46);
  assert.equal(toMidi('C'), null, 'a bare letter has no octave, so no pitch');
  assert.equal(toMidi('nonsense'), null);
});

test('a song that sits too high for a baritone is moved down', () => {
  const result = rankShifts({
    songLow: toMidi('E4'), songHigh: toMidi('E5'),
    singerLow: toMidi('A2'), singerHigh: toMidi('F4'),
  });
  assert.equal(result.impossible, false);
  assert.ok(result.best.fits);
  assert.ok(result.best.semitones < 0, 'must come down, not up');
  assert.ok(result.best.high <= toMidi('F4'));
});

test('a song wider than the singer is reported, not faked', () => {
  const result = rankShifts({
    songLow: toMidi('C3'), songHigh: toMidi('C6'),
    singerLow: toMidi('C4'), singerHigh: toMidi('C5'),
  });
  assert.equal(result.impossible, true);
  assert.equal(result.best.fits, false);
});

test('running out of room at the top is worse than at the bottom', () => {
  // Song fits exactly; the best answer should not push it against the ceiling.
  const result = rankShifts({
    songLow: toMidi('C4'), songHigh: toMidi('C5'),
    singerLow: toMidi('A3'), singerHigh: toMidi('E5'),
  });
  assert.ok(result.best.headroomTop >= 0 && result.best.headroomBottom >= 0);
  assert.ok(Math.abs(result.best.headroomTop - result.best.headroomBottom) <= 1, 'seated centrally');
});

test('missing inputs return null instead of a guess', () => {
  assert.equal(rankShifts({ songLow: 60, songHigh: 72, singerLow: null, singerHigh: 80 }), null);
});

test('the single-anchor shortcut', () => {
  // "The top note is E5 and I top out at C5."
  assert.equal(simpleShift({ songNote: toMidi('E5'), targetNote: toMidi('C5') }), -4);
});

test('resulting key after a shift', () => {
  assert.equal(keyName(shiftedKey(makeKey('E'), 1, 'auto', 4)), 'F');
  assert.equal(keyName(shiftedKey(makeKey('E'), -2, 'auto', 4)), 'D');
  assert.equal(keyName(shiftedKey(makeKey('C'), 3, 'auto', 0)), 'Eb');
});

test('range descriptions and presets', () => {
  assert.equal(describeRange(60, 72), 'C4–C5 (12 semitones)');
  assert.equal(describeRange(null, 72), '—');
  for (const p of VOICE_PRESETS) {
    assert.ok(toMidi(p.low) < toMidi(p.high), `${p.label} range is ordered`);
  }
});
