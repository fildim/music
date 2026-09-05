/**
 * Core pitch model.
 *
 * The whole app rests on one idea: transposition is an INTERVAL, not a
 * pitch-class lookup. A pitch-class transposer turns E->F correctly but then
 * spells the A chord as "A#" instead of "Bb". An interval transposer moves the
 * letter and the pitch independently, so every note lands on the right staff
 * line with the right accidental.
 *
 * A note is { letter: 'A'..'G', alter: -2..2, octave: number|null }.
 * `octave` is scientific pitch notation (middle C = C4 = MIDI 60); it is null
 * for pitch-class-only contexts such as chord symbols.
 */

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
// Position of each natural on the circle of fifths (= sharps in its major key).
const LETTER_FIFTHS = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };

const SHARP_CHARS = new Set(['#', '♯']);
const FLAT_CHARS = new Set(['b', '♭']);
const DOUBLE_SHARP_CHARS = new Set(['x', 'X', '\u{1D12A}']);
const DOUBLE_FLAT_CHARS = new Set(['\u{1D12B}']);
const NATURAL_CHARS = new Set(['♮']);

export const mod = (n, m) => ((n % m) + m) % m;

export function letterIndex(letter) {
  return LETTERS.indexOf(letter);
}

export function naturalPc(letter) {
  return NATURAL_PC[letterIndex(letter)];
}

/**
 * Parse an accidental run. Returns null for nonsense such as "#b" or "###".
 */
export function accidentalToAlter(text) {
  if (!text) return 0;
  let alter = 0;
  let sawSharp = false;
  let sawFlat = false;
  for (const ch of text) {
    if (SHARP_CHARS.has(ch)) { alter += 1; sawSharp = true; }
    else if (FLAT_CHARS.has(ch)) { alter -= 1; sawFlat = true; }
    else if (DOUBLE_SHARP_CHARS.has(ch)) { alter += 2; sawSharp = true; }
    else if (DOUBLE_FLAT_CHARS.has(ch)) { alter -= 2; sawFlat = true; }
    else if (NATURAL_CHARS.has(ch)) { /* no-op */ }
    else return null;
  }
  if (sawSharp && sawFlat) return null;   // "C#b" is not a note
  if (alter < -2 || alter > 2) return null;
  return alter;
}

export function alterToAccidental(alter, unicode = false) {
  const sharp = unicode ? '♯' : '#';
  const flat = unicode ? '♭' : 'b';
  if (alter === 0) return '';
  return alter > 0 ? sharp.repeat(alter) : flat.repeat(-alter);
}

const NOTE_RE = /^([A-Ga-g])((?:[#b♯♭♮x]|\u{1D12A}|\u{1D12B})*)(-?\d{1,2})?$/u;

export function parseNote(text, opts = {}) {
  const { allowLowercase = false, requireOctave = false, allowOctave = true } = opts;
  if (typeof text !== 'string') return null;
  const m = NOTE_RE.exec(text.trim());
  if (!m) return null;
  let letter = m[1];
  if (letter >= 'a' && letter <= 'g') {
    if (!allowLowercase) return null;
    letter = letter.toUpperCase();
  }
  const alter = accidentalToAlter(m[2]);
  if (alter === null) return null;
  if (m[3] !== undefined && !allowOctave) return null;
  const octave = m[3] === undefined ? null : parseInt(m[3], 10);
  if (requireOctave && octave === null) return null;
  if (octave !== null && (octave < -1 || octave > 10)) return null;
  return { letter, alter, octave };
}

export function noteName(note, { unicode = false, withOctave = true } = {}) {
  const oct = withOctave && note.octave !== null && note.octave !== undefined ? String(note.octave) : '';
  return note.letter + alterToAccidental(note.alter, unicode) + oct;
}

export function pitchClass(note) {
  return mod(naturalPc(note.letter) + note.alter, 12);
}

export function noteToMidi(note) {
  if (note.octave === null || note.octave === undefined) return null;
  return (note.octave + 1) * 12 + naturalPc(note.letter) + note.alter;
}

const SHARP_SPELLING = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_SPELLING = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** MIDI number -> spelled note. `prefer` is 'sharps' or 'flats'. */
export function midiToNote(midi, prefer = 'sharps') {
  const pc = mod(midi, 12);
  const name = (prefer === 'flats' ? FLAT_SPELLING : SHARP_SPELLING)[pc];
  const parsed = parseNote(name);
  parsed.octave = Math.floor(midi / 12) - 1;
  return parsed;
}

/* ------------------------------------------------------------------ keys */

/** A key is { tonic: note, mode: 'major'|'minor' }. */
export function makeKey(tonicText, mode = 'major') {
  const tonic = typeof tonicText === 'string'
    ? parseNote(tonicText, { allowOctave: false })
    : tonicText;
  if (!tonic) return null;
  return { tonic: { letter: tonic.letter, alter: tonic.alter, octave: null }, mode };
}

/** Signed count of sharps (+) or flats (-) in the key signature. */
export function keyFifths(key) {
  const base = LETTER_FIFTHS[key.tonic.letter] + 7 * key.tonic.alter;
  return key.mode === 'minor' ? base - 3 : base;
}

export function keyName(key, { unicode = false } = {}) {
  return noteName(key.tonic, { unicode, withOctave: false }) + (key.mode === 'minor' ? 'm' : '');
}

export function keyLabel(key, { unicode = false } = {}) {
  return noteName(key.tonic, { unicode, withOctave: false } ) + (key.mode === 'minor' ? ' minor' : ' major');
}

export function parseKey(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const m = /^([A-G](?:[#b♯♭]{1,2})?)\s*(m|min|minor|maj|major)?$/.exec(trimmed);
  if (!m) return null;
  const tonic = parseNote(m[1], { allowOctave: false });
  if (!tonic) return null;
  const mode = m[2] && /^m(in(or)?)?$/.test(m[2]) ? 'minor' : 'major';
  return { tonic, mode };
}

/**
 * Choose how to SPELL a key of a given pitch class.
 *
 * Ranked by the number of accidentals in the resulting key signature, so a
 * pitch class of 10 becomes Bb (2 flats) rather than A# (10 sharps). Ties
 * (F# vs Gb major, 6 either way) fall to `prefer`, then to the sharp/flat
 * leaning of `hintFifths` (normally the source key).
 */
export function spellKey(pc, mode = 'major', prefer = 'auto', hintFifths = 0) {
  const candidates = [];
  for (const letter of LETTERS) {
    for (let alter = -2; alter <= 2; alter++) {
      if (mod(NATURAL_PC[letterIndex(letter)] + alter, 12) !== mod(pc, 12)) continue;
      const key = { tonic: { letter, alter, octave: null }, mode };
      candidates.push({ key, fifths: keyFifths(key) });
    }
  }
  const wantSharp = prefer === 'sharps' ? 1 : prefer === 'flats' ? -1 : Math.sign(hintFifths) || 1;
  candidates.sort((a, b) => {
    const d = Math.abs(a.fifths) - Math.abs(b.fifths);
    if (d !== 0) return d;
    const aMatches = Math.sign(a.fifths) === wantSharp ? 0 : 1;
    const bMatches = Math.sign(b.fifths) === wantSharp ? 0 : 1;
    return aMatches - bMatches;
  });
  return candidates[0].key;
}

/* ------------------------------------------------------- transpositions */

/**
 * A transposition is a letter step plus a semitone step. Both are signed, and
 * both may exceed one octave (letterStep 7 == semitoneStep 12 == one octave).
 */
export function buildTransposition(sourceKey, targetKey, semitones) {
  const letterSimple = mod(letterIndex(targetKey.tonic.letter) - letterIndex(sourceKey.tonic.letter), 7);
  const semitoneSimple = mod(pitchClass(targetKey.tonic) - pitchClass(sourceKey.tonic), 12);
  if (mod(semitones - semitoneSimple, 12) !== 0) {
    throw new Error(
      `semitones (${semitones}) is not consistent with ${keyName(sourceKey)} -> ${keyName(targetKey)}`,
    );
  }
  const octaveShift = Math.round((semitones - semitoneSimple) / 12);
  return {
    letterStep: letterSimple + 7 * octaveShift,
    semitoneStep: semitoneSimple + 12 * octaveShift,
    sourceKey,
    targetKey,
  };
}

/** Identity transposition (used when only the octave moves, or nothing does). */
export function octaveTransposition(octaves) {
  return { letterStep: 7 * octaves, semitoneStep: 12 * octaves, sourceKey: null, targetKey: null };
}

const PLACEHOLDER_OCTAVE = 4;

export function transposeNote(note, t) {
  const hasOctave = note.octave !== null && note.octave !== undefined;
  const octave = hasOctave ? note.octave : PLACEHOLDER_OCTAVE;
  const li = letterIndex(note.letter);

  const diatonic = octave * 7 + li + t.letterStep;
  const newOctave = Math.floor(diatonic / 7);
  const newLetterIndex = mod(diatonic, 7);

  const midi = (octave + 1) * 12 + NATURAL_PC[li] + note.alter + t.semitoneStep;
  const newAlter = midi - ((newOctave + 1) * 12 + NATURAL_PC[newLetterIndex]);

  return {
    letter: LETTERS[newLetterIndex],
    alter: newAlter,
    octave: hasOctave ? newOctave : null,
  };
}

/** True when a note needs more than a double sharp/flat and must be respelled. */
export function isUnspellable(note) {
  return note.alter < -2 || note.alter > 2;
}

/** Fall back to a plain sharp/flat spelling when the interval produces C###. */
export function respell(note, prefer = 'sharps') {
  const pc = mod(naturalPc(note.letter) + note.alter, 12);
  const name = (prefer === 'flats' ? FLAT_SPELLING : SHARP_SPELLING)[pc];
  const fixed = parseNote(name, { allowOctave: false });
  // Keep the sounding octave, which may differ from the spelled one (Cb4 sounds B3).
  if (note.octave !== null && note.octave !== undefined) {
    const midi = (note.octave + 1) * 12 + naturalPc(note.letter) + note.alter;
    fixed.octave = Math.floor(midi / 12) - 1;
  } else {
    fixed.octave = null;
  }
  return fixed;
}

/** Semitone distance from key A up to key B, always in 0..11. */
export function semitonesBetweenKeys(a, b) {
  return mod(pitchClass(b.tonic) - pitchClass(a.tonic), 12);
}

/** Signed distance in -6..+5, i.e. "the shortest way to get there". */
export function nearestSemitones(a, b) {
  const up = semitonesBetweenKeys(a, b);
  return up > 6 ? up - 12 : up;
}

export const INTERVAL_NAMES = {
  0: 'unison', 1: 'minor 2nd', 2: 'major 2nd', 3: 'minor 3rd', 4: 'major 3rd',
  5: 'perfect 4th', 6: 'tritone', 7: 'perfect 5th', 8: 'minor 6th',
  9: 'major 6th', 10: 'minor 7th', 11: 'major 7th', 12: 'octave',
};

export function describeSemitones(semitones) {
  if (semitones === 0) return 'no change';
  const dir = semitones > 0 ? 'up' : 'down';
  const abs = Math.abs(semitones);
  const octaves = Math.floor(abs / 12);
  const rest = abs % 12;
  const parts = [];
  if (octaves) parts.push(octaves === 1 ? '1 octave' : `${octaves} octaves`);
  if (rest) parts.push(INTERVAL_NAMES[rest]);
  return `${dir} ${parts.join(' + ')} (${semitones > 0 ? '+' : ''}${semitones} semitone${abs === 1 ? '' : 's'})`;
}

/** The seven diatonic triads of a key, as { pc, quality, degree }. */
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_QUALITIES = ['', 'm', 'm', '', '', 'm', 'dim'];
const MAJOR_DEGREES = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii'];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const MINOR_QUALITIES = ['m', 'dim', '', 'm', 'm', '', ''];
const MINOR_DEGREES = ['i', 'ii', 'III', 'iv', 'v', 'VI', 'VII'];

export function diatonicTriads(key) {
  const steps = key.mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
  const quals = key.mode === 'minor' ? MINOR_QUALITIES : MAJOR_QUALITIES;
  const degs = key.mode === 'minor' ? MINOR_DEGREES : MAJOR_DEGREES;
  const root = pitchClass(key.tonic);
  return steps.map((s, i) => ({ pc: mod(root + s, 12), quality: quals[i], degree: degs[i] }));
}

/** Spelled scale of the key, used for Nashville numbers and note spelling. */
export function keyScale(key) {
  const steps = key.mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
  const tonicLetter = letterIndex(key.tonic.letter);
  const tonicPc = pitchClass(key.tonic);
  return steps.map((semitone, i) => {
    const li = mod(tonicLetter + i, 7);
    const natural = NATURAL_PC[li];
    let alter = mod(tonicPc + semitone - natural, 12);
    if (alter > 6) alter -= 12;
    return { letter: LETTERS[li], alter, octave: null };
  });
}

/**
 * Interval transposition is right for diatonic material but can spell an
 * out-of-key chord as Cb or E##. Where the note is NOT part of the target key
 * and an enharmonic exists with fewer accidentals, prefer that enharmonic.
 *
 * The in-key guard matters: E# really is the 7th degree of F# major and must
 * stay E#, while a Cb chord in F major should just be written B.
 */
export function simplifySpelling(note, targetKey) {
  if (!targetKey) return isUnspellable(note) ? respell(note) : note;
  if (note.alter === 0) return note;

  const scale = keyScale(targetKey);
  if (scale.some((s) => s.letter === note.letter && s.alter === note.alter)) return note;

  const pc = mod(naturalPc(note.letter) + note.alter, 12);
  let best = null;
  for (const letter of LETTERS) {
    for (let alter = -2; alter <= 2; alter++) {
      if (mod(NATURAL_PC[letterIndex(letter)] + alter, 12) !== pc) continue;
      if (Math.abs(alter) < Math.abs(note.alter) && (!best || Math.abs(alter) < Math.abs(best.alter))) {
        best = { letter, alter, octave: null };
      }
    }
  }
  if (!best) return isUnspellable(note) ? respell(note) : note;

  if (note.octave !== null && note.octave !== undefined) {
    const midi = (note.octave + 1) * 12 + naturalPc(note.letter) + note.alter;
    best.octave = Math.floor(midi / 12) - 1;
  }
  return best;
}

/** Transpose and tidy in one step — the entry point the rest of the app uses. */
export function transposeAndSpell(note, t, { simplify = true } = {}) {
  const moved = transposeNote(note, t);
  if (!simplify) return isUnspellable(moved) ? respell(moved) : moved;
  return simplifySpelling(moved, t.targetKey);
}
