/**
 * "Which key should this person sing it in?"
 *
 * Given the song's melody range and the singer's comfortable range, find the
 * transposition that seats the song inside that range. Running out of room at
 * the TOP is weighted more heavily than at the bottom: a note above someone's
 * ceiling is a note they cannot sing, whereas a note below it just goes quiet.
 */

import { parseNote, noteToMidi, midiToNote, noteName, spellKey, pitchClass, mod } from './theory.js';

/** Comfortable working ranges — a starting point, not a verdict on anyone. */
export const VOICE_PRESETS = [
  { id: 'soprano', label: 'Soprano', low: 'C4', high: 'A5' },
  { id: 'mezzo', label: 'Mezzo-soprano', low: 'A3', high: 'F5' },
  { id: 'alto', label: 'Alto', low: 'F3', high: 'D5' },
  { id: 'countertenor', label: 'Countertenor', low: 'G3', high: 'E5' },
  { id: 'tenor', label: 'Tenor', low: 'C3', high: 'A4' },
  { id: 'baritone', label: 'Baritone', low: 'A2', high: 'F4' },
  { id: 'bass', label: 'Bass', low: 'E2', high: 'D4' },
];

export function toMidi(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const note = parseNote(String(value), { allowLowercase: true, requireOctave: true });
  return note ? noteToMidi(note) : null;
}

export function describeRange(lowMidi, highMidi, prefer = 'sharps') {
  if (lowMidi === null || highMidi === null) return '—';
  const span = highMidi - lowMidi;
  return `${noteName(midiToNote(lowMidi, prefer))}–${noteName(midiToNote(highMidi, prefer))} (${span} semitone${span === 1 ? '' : 's'})`;
}

/**
 * Rank transpositions from best to worst fit.
 *
 * Needs both song boundaries and both singer boundaries. When only the tops (or
 * only the bottoms) are known, `simpleShift` below is the honest answer instead
 * of inventing the missing half.
 */
export function rankShifts({ songLow, songHigh, singerLow, singerHigh, maxShift = 12 }) {
  if ([songLow, songHigh, singerLow, singerHigh].some((v) => v === null || v === undefined)) return null;

  const songSpan = songHigh - songLow;
  const singerSpan = singerHigh - singerLow;
  const options = [];

  for (let shift = -maxShift; shift <= maxShift; shift += 1) {
    const low = songLow + shift;
    const high = songHigh + shift;
    const overTop = Math.max(0, high - singerHigh);
    const overBottom = Math.max(0, singerLow - low);
    const headTop = singerHigh - high;
    const headBottom = low - singerLow;
    const penalty = 12 * overTop + 9 * overBottom
      + Math.abs(headTop - headBottom)
      + 0.05 * Math.abs(shift);
    options.push({
      semitones: shift,
      low,
      high,
      headroomTop: headTop,
      headroomBottom: headBottom,
      fits: overTop === 0 && overBottom === 0,
      penalty,
    });
  }

  options.sort((a, b) => a.penalty - b.penalty || Math.abs(a.semitones) - Math.abs(b.semitones));
  return {
    options,
    best: options[0],
    // A song wider than the singer cannot be made to fit by any transposition.
    impossible: songSpan > singerSpan,
    songSpan,
    singerSpan,
  };
}

/** One boundary known on each side: just move the song so they meet. */
export function simpleShift({ songNote, targetNote }) {
  if (songNote === null || targetNote === null) return null;
  return targetNote - songNote;
}

/** Resulting key after shifting `sourceKey` by `semitones`. */
export function shiftedKey(sourceKey, semitones, prefer = 'auto', hintFifths = 0) {
  const pc = mod(pitchClass(sourceKey.tonic) + semitones, 12);
  return spellKey(pc, sourceKey.mode, prefer, hintFifths);
}
