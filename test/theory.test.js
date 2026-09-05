import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNote, noteName, makeKey, keyFifths, buildTransposition, transposeNote,
  transposeAndSpell, spellKey, keyScale, describeSemitones, noteToMidi,
  midiToNote, parseKey, accidentalToAlter, nearestSemitones, simplifySpelling,
} from '../src/theory.js';

const name = (n) => noteName(n);
const E_TO_F = buildTransposition(makeKey('E'), makeKey('F'), 1);

test('note parsing rejects nonsense', () => {
  assert.equal(parseNote('H'), null);
  assert.equal(parseNote('C#b'), null, 'mixed accidentals are not a note');
  assert.equal(parseNote('C###'), null, 'triple sharps are out of range');
  assert.equal(parseNote('c'), null, 'lowercase is off by default');
  assert.deepEqual(parseNote('c', { allowLowercase: true }).letter, 'C');
  assert.equal(accidentalToAlter('#b'), null);
  assert.equal(accidentalToAlter('##'), 2);
});

test('E to F transposition keeps correct spelling, not pitch-class names', () => {
  // The whole point: A must become Bb, never A#.
  assert.equal(name(transposeNote(parseNote('A'), E_TO_F)), 'Bb');
  assert.equal(name(transposeNote(parseNote('E'), E_TO_F)), 'F');
  assert.equal(name(transposeNote(parseNote('C#'), E_TO_F)), 'D');
  assert.equal(name(transposeNote(parseNote('G#'), E_TO_F)), 'A');
  assert.equal(name(transposeNote(parseNote('B'), E_TO_F)), 'C');
  assert.equal(name(transposeNote(parseNote('D#'), E_TO_F)), 'E');
});

test('octaves roll over at B, not at C', () => {
  assert.equal(name(transposeNote(parseNote('B4'), E_TO_F)), 'C5');
  assert.equal(name(transposeNote(parseNote('A4'), E_TO_F)), 'Bb4');
});

test('spelling is independent of the octave placeholder', () => {
  for (const oct of ['', '2', '4', '7']) {
    const moved = transposeNote(parseNote('A' + oct), E_TO_F);
    assert.equal(moved.letter + moved.alter, 'B-1', `octave ${oct || 'none'}`);
  }
});

test('transposing down moves pitch down', () => {
  const down = buildTransposition(makeKey('E'), makeKey('D'), -2);
  assert.equal(down.letterStep, -1);
  assert.equal(down.semitoneStep, -2);
  assert.equal(name(transposeNote(parseNote('A4'), down)), 'G4');
  assert.equal(name(transposeNote(parseNote('E4'), down)), 'D4');
});

test('a pure octave shift changes octave and nothing else', () => {
  const up = buildTransposition(makeKey('E'), makeKey('E'), 12);
  assert.equal(name(transposeNote(parseNote('A3'), up)), 'A4');
  const down = buildTransposition(makeKey('E'), makeKey('E'), -12);
  assert.equal(name(transposeNote(parseNote('A4'), down)), 'A3');
});

test('inconsistent semitone counts are rejected rather than silently wrong', () => {
  assert.throws(() => buildTransposition(makeKey('E'), makeKey('F'), 2));
});

test('awkward spellings simplify, but only outside the target key', () => {
  // Bb in E major becomes B natural in F major, not Cb.
  assert.equal(name(transposeAndSpell(parseNote('Bb'), E_TO_F)), 'B');
  // E# really is the seventh degree of F# major and must survive.
  const fToFSharp = buildTransposition(makeKey('F'), makeKey('F#'), 1);
  assert.equal(name(transposeAndSpell(parseNote('E'), fToFSharp)), 'E#');
  // Opting out gives the raw interval spelling back.
  assert.equal(name(transposeAndSpell(parseNote('Bb'), E_TO_F, { simplify: false })), 'Cb');
});

test('simplifying keeps the sounding pitch', () => {
  const cb = parseNote('Cb4');
  assert.equal(noteToMidi(cb), 59);
  const simple = simplifySpelling(cb, makeKey('F'));
  assert.equal(noteName(simple), 'B3');
  assert.equal(noteToMidi(simple), 59);
});

test('key signatures', () => {
  assert.equal(keyFifths(makeKey('C')), 0);
  assert.equal(keyFifths(makeKey('E')), 4);
  assert.equal(keyFifths(makeKey('F')), -1);
  assert.equal(keyFifths(makeKey('Bb')), -2);
  assert.equal(keyFifths(makeKey('A', 'minor')), 0);
  assert.equal(keyFifths(makeKey('E', 'minor')), 1);
  assert.equal(keyFifths(makeKey('C', 'minor')), -3);
});

test('keys are spelled by signature complexity, not by pitch class order', () => {
  assert.equal(noteName(spellKey(10, 'major').tonic), 'Bb', 'not A# (10 sharps)');
  assert.equal(noteName(spellKey(3, 'major').tonic), 'Eb', 'not D# (9 sharps)');
  assert.equal(noteName(spellKey(1, 'major').tonic), 'Db', 'not C# (7 sharps)');
  assert.equal(noteName(spellKey(1, 'minor').tonic), 'C#', 'minor goes the other way');
  assert.equal(noteName(spellKey(6, 'major', 'sharps').tonic), 'F#');
  assert.equal(noteName(spellKey(6, 'major', 'flats').tonic), 'Gb');
});

test('scales are spelled with one of each letter', () => {
  assert.deepEqual(keyScale(makeKey('E')).map(noteName), ['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#']);
  assert.deepEqual(keyScale(makeKey('F')).map(noteName), ['F', 'G', 'A', 'Bb', 'C', 'D', 'E']);
  assert.deepEqual(keyScale(makeKey('F#')).map(noteName), ['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#']);
  assert.deepEqual(keyScale(makeKey('A', 'minor')).map(noteName), ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
});

test('midi round trips', () => {
  assert.equal(noteToMidi(parseNote('C4')), 60);
  assert.equal(noteToMidi(parseNote('A4')), 69);
  assert.equal(noteName(midiToNote(60)), 'C4');
  assert.equal(noteName(midiToNote(70, 'flats')), 'Bb4');
});

test('interval descriptions read like music, not like arithmetic', () => {
  assert.equal(describeSemitones(1), 'up minor 2nd (+1 semitone)');
  assert.equal(describeSemitones(-2), 'down major 2nd (-2 semitones)');
  assert.equal(describeSemitones(12), 'up 1 octave (+12 semitones)');
  assert.equal(describeSemitones(13), 'up 1 octave + minor 2nd (+13 semitones)');
  assert.equal(describeSemitones(0), 'no change');
});

test('key text parsing', () => {
  assert.equal(parseKey('Bbm').mode, 'minor');
  assert.equal(parseKey('F# major').mode, 'major');
  assert.equal(parseKey('Gibberish'), null);
  assert.equal(nearestSemitones(makeKey('E'), makeKey('D')), -2);
  assert.equal(nearestSemitones(makeKey('E'), makeKey('F')), 1);
});
