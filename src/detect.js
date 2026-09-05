/**
 * Key detection from a chord list.
 *
 * Scores all 24 keys by how well the chords fit their diatonic triads, with
 * extra weight on the chords that actually establish a key: the tonic (and
 * especially the LAST chord, since songs land on home) and the dominant.
 */

import { makeKey, pitchClass, mod, spellKey, keyFifths } from './theory.js';
import { parseChord } from './chords.js';

/** Reduce a chord quality string to the triad it implies. */
export function triadQuality(chord) {
  const q = chord.quality;
  if (/^(dim|°|o(?!m)|ø|Ø)/.test(q) || /b5/.test(q) && /^(m|min|-)/.test(q)) return 'dim';
  if (/^(aug|\+)/.test(q) || /^[^b]*#5/.test(q)) return 'aug';
  if (/^(maj|Maj|MAJ|M(?![a-z])|Δ|△|\^)/.test(q)) return 'maj';
  if (/^(m|min|Min|minor|-)/.test(q)) return 'min';
  if (/^sus/.test(q)) return 'sus';
  return 'maj';
}

const MAJOR = [
  { step: 0, quality: 'maj', weight: 6 },
  { step: 2, quality: 'min', weight: 3 },
  { step: 4, quality: 'min', weight: 3 },
  { step: 5, quality: 'maj', weight: 5 },
  { step: 7, quality: 'maj', weight: 6 },
  { step: 9, quality: 'min', weight: 4 },
  { step: 11, quality: 'dim', weight: 2 },
];

const MINOR = [
  { step: 0, quality: 'min', weight: 6 },
  { step: 2, quality: 'dim', weight: 2 },
  { step: 3, quality: 'maj', weight: 4 },
  { step: 5, quality: 'min', weight: 5 },
  { step: 7, quality: 'min', weight: 4 },
  { step: 7, quality: 'maj', weight: 5 },   // harmonic minor V — very common
  { step: 8, quality: 'maj', weight: 4 },
  { step: 10, quality: 'maj', weight: 4 },
];

function scoreKey(chords, key) {
  const table = key.mode === 'minor' ? MINOR : MAJOR;
  const tonic = pitchClass(key.tonic);
  let score = 0;

  chords.forEach((chord) => {
    const interval = mod(pitchClass(chord.root) - tonic, 12);
    const quality = triadQuality(chord);
    const exact = table.find((d) => d.step === interval && (d.quality === quality || quality === 'sus'));
    if (exact) { score += exact.weight; return; }
    const rootOnly = table.find((d) => d.step === interval);
    if (rootOnly) { score += 1; return; }   // borrowed/secondary chord
    score -= 3;                             // genuinely foreign
  });

  if (chords.length) {
    const first = mod(pitchClass(chords[0].root) - tonic, 12);
    const last = mod(pitchClass(chords[chords.length - 1].root) - tonic, 12);
    if (first === 0) score += 4;
    if (last === 0) score += 8;             // ending on home is the strongest cue
    else if (last === 7) score += 1;
  }
  return score;
}

/**
 * Rank every key. Returns [{ key, score, confidence }] best first.
 *
 * Candidates are enumerated by pitch class, not by letter+accidental, so Bb
 * major and A# major do not compete against each other as if they were rivals.
 * The winning pitch class is then SPELLED by key-signature complexity, which is
 * why Bb (2 flats) is reported rather than A# (10 sharps).
 */
export function rankKeys(chords) {
  if (!chords.length) return [];

  // A sheet written with Bb and Eb chords is a flat sheet; let that steer ties
  // such as F# major vs Gb major.
  let lean = 0;
  for (const chord of chords) lean += Math.sign(chord.root.alter);

  const results = [];
  for (let pc = 0; pc < 12; pc += 1) {
    for (const mode of ['major', 'minor']) {
      const key = spellKey(pc, mode, 'auto', lean);
      results.push({ key, score: scoreKey(chords, key) });
    }
  }
  results.sort((a, b) => b.score - a.score || Math.abs(keyFifths(a.key)) - Math.abs(keyFifths(b.key)));

  const best = results[0].score;
  const runnerUp = results[1]?.score ?? 0;
  const spread = Math.max(1, Math.abs(best));
  return results.map((r, i) => ({
    ...r,
    confidence: i === 0 ? Math.max(0, Math.min(1, (best - runnerUp) / spread)) : 0,
  }));
}

export function detectKey(chords, declaredKey = null) {
  if (declaredKey) return { key: declaredKey, confidence: 1, source: 'declared' };
  const ranked = rankKeys(chords);
  if (!ranked.length) return null;
  return { key: ranked[0].key, confidence: ranked[0].confidence, source: 'detected', ranked: ranked.slice(0, 4) };
}

/** Convenience for callers holding raw text tokens rather than chord objects. */
export function detectKeyFromTokens(tokens) {
  return detectKey(tokens.map(parseChord).filter(Boolean));
}

export { makeKey };
