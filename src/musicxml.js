/**
 * MusicXML transposition.
 *
 * Rewrites only the elements that carry pitch and leaves the rest of the file
 * exactly as it was found — no DOM round-trip, so comments, DOCTYPE, layout and
 * formatting all survive, and the result opens cleanly in MuseScore/Sibelius.
 *
 * What is changed: <pitch> in every <note>, <fifths> in every <key>, and the
 * <root>/<bass> of every <harmony> (chord symbol).
 * What is deliberately NOT changed: <transpose> (that describes the instrument,
 * not the music) and <unpitched> (percussion has no key).
 */

import {
  parseNote, noteToMidi, transposeAndSpell, keyFifths, noteName,
} from './theory.js';

const NOTE_BLOCK = /<note\b[^>]*>[\s\S]*?<\/note>/g;
const KEY_BLOCK = /<key\b[^>]*>[\s\S]*?<\/key>/g;
const HARMONY_BLOCK = /<harmony\b[^>]*>[\s\S]*?<\/harmony>/g;
const PITCH_BLOCK = /<pitch\b[^>]*>[\s\S]*?<\/pitch>/;

const ACCIDENTAL_NAMES = { '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };

const tag = (name, body) => new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`);

function readTag(xml, name) {
  const m = tag(name).exec(xml);
  return m ? m[1] : null;
}

function writeTag(xml, name, value) {
  return xml.replace(tag(name), `<${name}>${value}</${name}>`);
}

function removeTag(xml, name) {
  return xml.replace(new RegExp(`\\s*<${name}>[^<]*</${name}>`), '');
}

/** Insert <alter> immediately after <step>, which is where the schema wants it. */
function insertAlter(pitchXml, value) {
  return pitchXml.replace(/(<step>[^<]*<\/step>)/, `$1<alter>${value}</alter>`);
}

/** Read the file's own key signature and melodic range without changing it. */
export function inspectMusicXml(xml) {
  const fifthsMatches = [...xml.matchAll(/<fifths>\s*(-?\d+)\s*<\/fifths>/g)].map((m) => parseInt(m[1], 10));
  const modeMatch = /<mode>\s*([a-zA-Z]+)\s*<\/mode>/.exec(xml);

  let low = null;
  let high = null;
  let count = 0;
  for (const block of xml.match(NOTE_BLOCK) ?? []) {
    const pitch = PITCH_BLOCK.exec(block);
    if (!pitch) continue;
    const step = readTag(pitch[0], 'step');
    const octave = readTag(pitch[0], 'octave');
    const alter = readTag(pitch[0], 'alter');
    if (!step || octave === null) continue;
    const note = parseNote(step + (alter ? (Number(alter) > 0 ? '#'.repeat(Number(alter)) : 'b'.repeat(-Number(alter))) : '') + octave);
    if (!note) continue;
    const midi = noteToMidi(note);
    if (midi === null) continue;
    count += 1;
    if (low === null || midi < low) low = midi;
    if (high === null || midi > high) high = midi;
  }

  return {
    fifths: fifthsMatches.length ? fifthsMatches[0] : null,
    allFifths: fifthsMatches,
    mode: modeMatch ? modeMatch[1].toLowerCase() : null,
    lowMidi: low,
    highMidi: high,
    noteCount: count,
    keyChanges: new Set(fifthsMatches).size > 1,
  };
}

export function transposeMusicXml(xml, t, options = {}) {
  const opts = { simplify: true, ...options };
  const warnings = [];
  let microtonal = 0;
  let unspellable = 0;
  let notesMoved = 0;

  const movePitch = (pitchXml) => {
    const step = readTag(pitchXml, 'step');
    const octaveText = readTag(pitchXml, 'octave');
    const alterText = readTag(pitchXml, 'alter');
    if (!step || octaveText === null) return pitchXml;

    const alter = alterText === null ? 0 : Number(alterText);
    if (!Number.isInteger(alter)) { microtonal += 1; return pitchXml; }
    if (Math.abs(alter) > 2) { unspellable += 1; return pitchXml; }

    const note = { letter: step, alter, octave: parseInt(octaveText, 10) };
    const moved = transposeAndSpell(note, t, opts);
    notesMoved += 1;

    let out = writeTag(pitchXml, 'step', moved.letter);
    out = writeTag(out, 'octave', String(moved.octave));
    if (moved.alter === 0) out = removeTag(out, 'alter');
    else if (alterText === null) out = insertAlter(out, moved.alter);
    else out = writeTag(out, 'alter', String(moved.alter));
    return out;
  };

  let result = xml.replace(NOTE_BLOCK, (block) => {
    const pitch = PITCH_BLOCK.exec(block);
    if (!pitch) return block;                        // rest, or unpitched percussion
    const before = pitch[0];
    const after = movePitch(before);
    let out = block.slice(0, pitch.index) + after + block.slice(pitch.index + before.length);

    // The printed accidental must follow the new spelling: an A# that becomes B
    // in a flat key needs a natural sign, not the sharp it used to carry.
    if (/<accidental\b[^>]*>/.test(out)) {
      const newAlter = readTag(after, 'alter');
      const name = ACCIDENTAL_NAMES[String(newAlter === null ? 0 : Number(newAlter))];
      if (name) out = out.replace(/(<accidental\b[^>]*>)[^<]*(<\/accidental>)/, `$1${name}$2`);
    }
    return out;
  });

  // Key signatures shift by a fixed number of steps around the circle of fifths.
  if (t.sourceKey && t.targetKey) {
    const delta = keyFifths(t.targetKey) - keyFifths(t.sourceKey);
    let clamped = false;
    result = result.replace(KEY_BLOCK, (block) => block.replace(
      /<fifths>\s*(-?\d+)\s*<\/fifths>/,
      (_, value) => {
        let next = parseInt(value, 10) + delta;
        while (next > 7) { next -= 12; clamped = true; }
        while (next < -7) { next += 12; clamped = true; }
        return `<fifths>${next}</fifths>`;
      },
    ));
    if (clamped) {
      warnings.push('A key signature needed more than 7 sharps or flats and was respelled enharmonically; check the accidentals in that section.');
    }
  }

  // Chord symbols printed above the staff.
  result = result.replace(HARMONY_BLOCK, (block) => {
    let out = block;
    for (const [stepTag, alterTag] of [['root-step', 'root-alter'], ['bass-step', 'bass-alter']]) {
      const step = readTag(out, stepTag);
      if (!step) continue;
      const alterText = readTag(out, alterTag);
      const alter = alterText === null ? 0 : Number(alterText);
      if (!Number.isInteger(alter)) continue;
      const moved = transposeAndSpell({ letter: step, alter, octave: null }, t, opts);
      out = writeTag(out, stepTag, moved.letter);
      if (moved.alter === 0) out = removeTag(out, alterTag);
      else if (alterText === null) {
        out = out.replace(new RegExp(`(<${stepTag}>[^<]*</${stepTag}>)`), `$1<${alterTag}>${moved.alter}</${alterTag}>`);
      } else out = writeTag(out, alterTag, String(moved.alter));
    }
    return out;
  });

  if (microtonal) warnings.push(`${microtonal} microtonal note(s) had a fractional <alter> and were left untouched.`);
  if (unspellable) warnings.push(`${unspellable} note(s) used a triple accidental and were left untouched.`);
  if (notesMoved === 0) warnings.push('No pitched notes were found in this file.');

  return { xml: result, warnings, notesMoved };
}

export { noteName };
