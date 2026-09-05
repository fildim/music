/**
 * Chord symbol parsing.
 *
 * The hard part is not transposition, it is deciding what IS a chord. A
 * permissive parser reads the lyric "Bad" as B-add and "Cage" as C-aug, and
 * then silently rewrites the words in someone's song. So the quality after the
 * root is matched against a closed grammar:
 *
 *     quality := base? extension*
 *
 * "Bad" -> root B, rest "ad": "a" is not a base and "ad" is not "add" -> not a
 * chord. "Cage", "Face", "Amen", "Golden", "Around" all fail the same way.
 */

import {
  parseNote, noteName, transposeAndSpell, pitchClass, mod,
} from './theory.js';

const BASE_TOKENS = [
  'major', 'minor', 'MAJ', 'Maj', 'maj', 'Min', 'min', 'dim', 'DIM', 'aug', 'AUG',
  'M', 'm', '-', '+', '°', 'o', 'ø', 'Ø', 'Δ', '△', '^',
].sort((a, b) => b.length - a.length);

const EXT_TOKENS = [
  'maj13', 'maj11', 'maj9', 'maj7', 'Maj7', 'MAJ7', 'M13', 'M11', 'M9', 'M7',
  'Δ7', '△7', '^7', 'sus4', 'sus2', 'sus', 'add13', 'add11', 'add9', 'add6',
  'add4', 'add2', 'add', 'alt', 'no3', 'no5', 'omit3', 'omit5', 'dim7', 'dim',
  '13', '11', '69', '9', '7', '6', '5', '4', '3', '2', '(', ')', ',', '/', ' ',
].sort((a, b) => b.length - a.length);

const ALTERATION_RE = /^[#b♯♭+-]\d{1,2}/;
const ROOT_RE = /^([A-G])((?:[#b♯♭]){0,2})([\s\S]*)$/;
const BASS_RE = /^([\s\S]*)\/([A-G](?:[#b♯♭]){0,2})$/;

/** Bar lines, repeats and rhythm slashes that legitimately sit on a chord line. */
const MARKERS = new Set([
  '|', '||', '|:', ':|', ':||', '||:', '|.', '/', '//', '%', '-', '(', ')',
  '*', 'N.C.', 'NC', 'n.c.', '.', '¦',
]);
const MARKER_RE = /^(?:x\d{1,2}|\d{1,2}x|\(\d{1,2}x\)|\[\d{1,2}x\])$/i;

export function isMarker(token) {
  return MARKERS.has(token) || MARKER_RE.test(token);
}

function validQuality(quality) {
  if (quality === '') return { valid: true, weak: false };
  let i = 0;
  let weak = false;

  for (const token of BASE_TOKENS) {
    if (quality.startsWith(token)) {
      // A bare "o" for diminished is real notation (Co7) but also the tail of
      // the words "Do" and "Go", so chords built on it are flagged as weak.
      if (token === 'o' || token === 'O') weak = true;
      i = token.length;
      break;
    }
  }

  let depth = 0;
  let guard = 0;
  while (i < quality.length) {
    if (guard++ > 64) return { valid: false, weak };
    const rest = quality.slice(i);

    const alt = ALTERATION_RE.exec(rest);
    if (alt) { i += alt[0].length; continue; }

    let matched = null;
    for (const token of EXT_TOKENS) {
      if (rest.startsWith(token)) { matched = token; break; }
    }
    if (!matched) return { valid: false, weak };
    if (matched === '(') depth += 1;
    if (matched === ')') { if (depth === 0) return { valid: false, weak }; depth -= 1; }
    i += matched.length;
  }
  return { valid: depth === 0, weak };
}

/**
 * Parse a single token. Returns null when the token is not a chord.
 * `weak` marks chords whose reading is plausible but not certain, so the line
 * classifier can refuse to rewrite a lyric line that just says "Go".
 */
export function parseChord(token) {
  if (typeof token !== 'string' || token === '') return null;
  const rootMatch = ROOT_RE.exec(token);
  if (!rootMatch) return null;

  const root = parseNote(rootMatch[1] + rootMatch[2], { allowOctave: false });
  if (!root) return null;

  let rest = rootMatch[3];
  let bass = null;
  const bassMatch = BASS_RE.exec(rest);
  if (bassMatch) {
    const candidate = parseNote(bassMatch[2], { allowOctave: false });
    if (candidate) { bass = candidate; rest = bassMatch[1]; }
  }

  const { valid, weak } = validQuality(rest);
  if (!valid) return null;
  return { root, quality: rest, bass, weak };
}

export function formatChord(chord, { unicode = false } = {}) {
  let out = noteName(chord.root, { unicode, withOctave: false }) + chord.quality;
  if (chord.bass) out += '/' + noteName(chord.bass, { unicode, withOctave: false });
  return out;
}

export function transposeChord(chord, t, opts = {}) {
  return {
    root: transposeAndSpell(chord.root, t, opts),
    quality: chord.quality,
    bass: chord.bass ? transposeAndSpell(chord.bass, t, opts) : null,
    weak: chord.weak,
  };
}

/** Convenience: "Am7/G" -> "Bbm7/Ab" in one call. Returns the input unchanged
 *  if it is not a chord, so it is safe to map over arbitrary tokens. */
export function transposeToken(token, t, opts = {}) {
  const chord = parseChord(token);
  if (!chord) return token;
  return formatChord(transposeChord(chord, t, opts), opts);
}

/* --------------------------------------------------- Nashville numbers */

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
// Minor-key charts spell the lowered degrees explicitly, so 1 2 b3 4 5 b6 b7.
const MAJOR_LABELS = ['1', '2', '3', '4', '5', '6', '7'];
const MINOR_LABELS = ['1', '2', 'b3', '4', '5', 'b6', 'b7'];
// Chromatic degrees use the conventional spelling (b7, not #6; #4, not b5).
const MAJOR_CHROMATIC = { 1: 'b2', 3: 'b3', 6: '#4', 8: 'b6', 10: 'b7' };
const MINOR_CHROMATIC = { 1: 'b2', 4: '3', 6: '#4', 9: '6', 11: '7' };

function degreeLabel(interval, mode) {
  const steps = mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
  const labels = mode === 'minor' ? MINOR_LABELS : MAJOR_LABELS;
  const index = steps.indexOf(interval);
  if (index !== -1) return labels[index];
  return (mode === 'minor' ? MINOR_CHROMATIC : MAJOR_CHROMATIC)[interval] ?? null;
}

export function chordToNashville(chord, key) {
  const tonicPc = pitchClass(key.tonic);
  const label = degreeLabel(mod(pitchClass(chord.root) - tonicPc, 12), key.mode);
  if (label === null) return null;

  let out = label + chord.quality;
  if (chord.bass) {
    const bassLabel = degreeLabel(mod(pitchClass(chord.bass) - tonicPc, 12), key.mode);
    out += '/' + (bassLabel ?? noteName(chord.bass, { withOctave: false }));
  }
  return out;
}
