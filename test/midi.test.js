import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transposeMidi, inspectMidi } from '../src/midi.js';

/** Build a Standard MIDI File from raw track bytes. */
function smf(trackBytes) {
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96];
  const n = trackBytes.length;
  return Uint8Array.from([
    ...header, 0x4d, 0x54, 0x72, 0x6b,
    (n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255, ...trackBytes,
  ]);
}

const END = [0x00, 0xff, 0x2f, 0x00];
/** Byte offset of the first track's data: 14-byte header + 8-byte MTrk chunk header. */
const TRACK_DATA = 22;

test('notes move, key signature follows', () => {
  const file = smf([
    0x00, 0xff, 0x59, 0x02, 0x04, 0x00,   // 4 sharps, major
    0x00, 0x90, 64, 100,                  // E4 on
    0x60, 0x80, 64, 0,                    // E4 off
    ...END,
  ]);
  assert.deepEqual(inspectMidi(file), { lowMidi: 64, highMidi: 64, noteCount: 1, fifths: 4, mode: 'major' });
  const { bytes, notesMoved } = transposeMidi(file, 1, { fifthsDelta: -5 });
  assert.equal(notesMoved, 2, 'both the note-on and its note-off move');
  const after = inspectMidi(bytes);
  assert.equal(after.lowMidi, 65);
  assert.equal(after.fifths, -1, 'E major -> F major');
});

test('running status events are found', () => {
  // The second note-on omits its status byte entirely.
  const file = smf([0x00, 0x90, 60, 100, 0x10, 62, 100, 0x10, 64, 100, ...END]);
  assert.equal(inspectMidi(file).noteCount, 3);
  const { bytes, notesMoved } = transposeMidi(file, 2);
  assert.equal(notesMoved, 3, 'all three, not just the one with a status byte');
  assert.deepEqual([inspectMidi(bytes).lowMidi, inspectMidi(bytes).highMidi], [62, 66]);
});

test('channel 10 percussion is never transposed', () => {
  const file = smf([0x00, 0x99, 38, 100, 0x00, 0x90, 60, 100, ...END]);
  const { bytes, notesMoved, warnings } = transposeMidi(file, 5);
  assert.equal(notesMoved, 1, 'only the pitched note');
  assert.ok(warnings.some((w) => /percussion/.test(w)));
  assert.equal(bytes[TRACK_DATA + 2], 38, 'the snare is still a snare');
});

test('notes that would leave the midi range keep their pitch and are reported', () => {
  const file = smf([0x00, 0x90, 126, 100, ...END]);
  const { bytes, warnings, notesMoved } = transposeMidi(file, 6);
  assert.equal(notesMoved, 0);
  assert.equal(bytes[TRACK_DATA + 2], 126, 'left alone rather than clamped to a wrong pitch');
  assert.ok(warnings.some((w) => /outside the MIDI range/.test(w)));
});

test('sysex and meta events do not derail the walk', () => {
  const file = smf([
    0x00, 0xf0, 0x03, 0x7e, 0x7f, 0xf7,               // sysex
    0x00, 0xff, 0x03, 0x04, 0x54, 0x65, 0x73, 0x74,   // track name "Test"
    0x00, 0x90, 60, 100,
    ...END,
  ]);
  assert.equal(inspectMidi(file).noteCount, 1);
  assert.equal(transposeMidi(file, 1).notesMoved, 1);
});

test('note-on with velocity zero counts as a note off, not a sounding note', () => {
  const file = smf([0x00, 0x90, 60, 100, 0x10, 60, 0, ...END]);
  assert.equal(inspectMidi(file).noteCount, 1);
});

test('a file that is not midi is rejected clearly', () => {
  assert.throws(() => inspectMidi(Uint8Array.from([1, 2, 3, 4])), /Not a Standard MIDI File/);
});
