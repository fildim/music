/**
 * Standard MIDI File transposition.
 *
 * Note numbers are single bytes, so once the event stream is walked correctly
 * the transposition is an in-place byte edit and every track length, delta time
 * and running-status run stays valid.
 *
 * Two things a naive "add N to every byte that looks like a note" gets wrong and
 * this does not: running status (an event may omit its status byte entirely, so
 * you cannot find note events by scanning for 0x90) and channel 10, which is
 * percussion — transposing it turns a snare into a cowbell.
 */

const PERCUSSION_CHANNEL = 9;   // zero-indexed; "channel 10" in the manuals

function readUint32(bytes, pos) {
  return ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
}

function readVarint(bytes, pos) {
  let value = 0;
  let i = pos;
  for (let n = 0; n < 4; n += 1) {
    const b = bytes[i];
    if (b === undefined) throw new Error('Truncated MIDI file (unterminated variable-length value).');
    i += 1;
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) return { value, next: i };
  }
  throw new Error('Malformed MIDI file (variable-length value longer than 4 bytes).');
}

/**
 * Walk every event, calling back for note bytes and key-signature metas.
 * Shared by inspect and transpose so the two can never disagree.
 */
function walk(bytes, { onNote, onKeySignature }) {
  const ascii = (pos, len) => String.fromCharCode(...bytes.slice(pos, pos + len));
  if (bytes.length < 14 || ascii(0, 4) !== 'MThd') {
    throw new Error('Not a Standard MIDI File (missing MThd header).');
  }

  let pos = 8 + readUint32(bytes, 4);
  while (pos + 8 <= bytes.length) {
    const chunkType = ascii(pos, 4);
    const length = readUint32(bytes, pos + 4);
    const start = pos + 8;
    const end = Math.min(start + length, bytes.length);
    pos = start + length;
    if (chunkType !== 'MTrk') continue;   // skip unknown chunks, per the spec

    let cursor = start;
    let runningStatus = null;
    while (cursor < end) {
      ({ next: cursor } = readVarint(bytes, cursor));
      if (cursor >= end) break;

      let status = bytes[cursor];
      if (status >= 0x80) cursor += 1;
      else if (runningStatus !== null) status = runningStatus;
      else throw new Error('Malformed MIDI file (data byte with no running status).');

      if (status === 0xff) {
        const metaType = bytes[cursor];
        cursor += 1;
        const { value: len, next } = readVarint(bytes, cursor);
        if (metaType === 0x59 && len === 2) onKeySignature?.(next);
        cursor = next + len;
        runningStatus = null;
      } else if (status === 0xf0 || status === 0xf7) {
        const { value: len, next } = readVarint(bytes, cursor);
        cursor = next + len;
        runningStatus = null;
      } else {
        runningStatus = status;
        const type = status & 0xf0;
        const channel = status & 0x0f;
        if (type === 0x80 || type === 0x90 || type === 0xa0) {
          onNote?.(cursor, channel, type);
          cursor += 2;
        } else if (type === 0xb0 || type === 0xe0) {
          cursor += 2;
        } else if (type === 0xc0 || type === 0xd0) {
          cursor += 1;
        } else {
          throw new Error(`Malformed MIDI file (unknown status byte 0x${status.toString(16)}).`);
        }
      }
    }
  }
}

export function inspectMidi(bytes) {
  let low = null;
  let high = null;
  let count = 0;
  let fifths = null;
  let mode = null;

  walk(bytes, {
    onNote(pos, channel, type) {
      if (channel === PERCUSSION_CHANNEL) return;
      if (type === 0xa0) return;                       // aftertouch is not a sounding note
      if (type === 0x90 && bytes[pos + 1] === 0) return; // note-on velocity 0 == note off
      if (type === 0x80) return;
      const note = bytes[pos];
      count += 1;
      if (low === null || note < low) low = note;
      if (high === null || note > high) high = note;
    },
    onKeySignature(pos) {
      if (fifths === null) {
        fifths = (bytes[pos] << 24) >> 24;             // signed byte
        mode = bytes[pos + 1] === 1 ? 'minor' : 'major';
      }
    },
  });

  return { lowMidi: low, highMidi: high, noteCount: count, fifths, mode };
}

export function transposeMidi(bytes, semitones, { fifthsDelta = null } = {}) {
  const out = Uint8Array.from(bytes);
  const warnings = [];
  let moved = 0;
  let clamped = 0;
  let percussionSkipped = 0;

  walk(out, {
    onNote(pos, channel) {
      if (channel === PERCUSSION_CHANNEL) { percussionSkipped += 1; return; }
      const next = out[pos] + semitones;
      if (next < 0 || next > 127) { clamped += 1; return; }  // leave rather than fold to a wrong octave
      out[pos] = next;
      moved += 1;
    },
    onKeySignature(pos) {
      if (fifthsDelta === null) return;
      let next = ((out[pos] << 24) >> 24) + fifthsDelta;
      while (next > 7) next -= 12;
      while (next < -7) next += 12;
      out[pos] = next & 0xff;
    },
  });

  if (clamped) warnings.push(`${clamped} note(s) would have fallen outside the MIDI range and were left at their original pitch.`);
  if (percussionSkipped) warnings.push(`${percussionSkipped} percussion event(s) on channel 10 were left alone, as drums have no key.`);
  if (moved === 0 && clamped === 0) warnings.push('No transposable notes were found in this file.');

  return { bytes: out, warnings, notesMoved: moved };
}
