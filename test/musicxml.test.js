import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transposeMusicXml, inspectMusicXml } from '../src/musicxml.js';
import { makeKey, buildTransposition } from '../src/theory.js';

const xml = readFileSync(new URL('../examples/sample.musicxml', import.meta.url), 'utf8');
const E_TO_F = buildTransposition(makeKey('E'), makeKey('F'), 1);

test('inspection reads the key and the melodic range', () => {
  const info = inspectMusicXml(xml);
  assert.equal(info.fifths, 4);
  assert.equal(info.mode, 'major');
  assert.equal(info.lowMidi, 64);   // E4
  assert.equal(info.highMidi, 74);  // D5
  assert.equal(info.noteCount, 5);
});

test('pitches move and are spelled for the new key', () => {
  const { xml: out, warnings } = transposeMusicXml(xml, E_TO_F);
  assert.deepEqual(warnings, []);
  assert.match(out, /<step>F<\/step><octave>4<\/octave>/, 'E4 -> F4');
  assert.match(out, /<step>A<\/step><octave>4<\/octave>/, 'G#4 -> A4, alter removed');
  assert.match(out, /<step>B<\/step><alter>-1<\/alter><octave>4<\/octave>/, 'A4 -> Bb4, not A#4');
  assert.match(out, /<step>C<\/step><octave>5<\/octave>/, 'B4 -> C5, octave rolls over');
});

test('the key signature follows', () => {
  const { xml: out } = transposeMusicXml(xml, E_TO_F);
  assert.match(out, /<fifths>-1<\/fifths>/, 'E major (4 sharps) -> F major (1 flat)');
});

test('printed accidentals are rewritten to match the new spelling', () => {
  const { xml: out } = transposeMusicXml(xml, E_TO_F);
  // The natural A becomes B-flat, so its printed natural must become a flat.
  assert.match(out, /<accidental>flat<\/accidental>/);
  assert.doesNotMatch(out, /<accidental>natural<\/accidental>/);
});

test('chord symbols above the staff move too', () => {
  const { xml: out } = transposeMusicXml(xml, E_TO_F);
  assert.match(out, /<root-step>F<\/root-step>/);
  assert.match(out, /<root-step>B<\/root-step><root-alter>-1<\/root-alter>/, 'A -> Bb');
  assert.match(out, /<bass-step>D<\/bass-step>/, 'C# bass -> D, alter removed');
});

test('rests and the rest of the file survive untouched', () => {
  const { xml: out } = transposeMusicXml(xml, E_TO_F);
  assert.match(out, /<note><rest\/><duration>1<\/duration><type>quarter<\/type><\/note>/);
  assert.match(out, /<!DOCTYPE score-partwise/, 'the doctype is preserved');
  assert.match(out, /<part-name>Voice<\/part-name>/);
  assert.equal(out.split('\n').length, xml.split('\n').length, 'formatting is not reflowed');
});

test('unpitched percussion is not transposed', () => {
  const drums = `<score-partwise><part id="P1"><measure number="1">
    <note><unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched><duration>1</duration></note>
  </measure></part></score-partwise>`;
  const { xml: out, notesMoved } = transposeMusicXml(drums, E_TO_F);
  assert.equal(notesMoved, 0);
  assert.match(out, /<display-step>E<\/display-step>/);
});

test('microtones are left alone rather than mangled', () => {
  const quarter = `<score-partwise><part id="P1"><measure number="1">
    <note><pitch><step>E</step><alter>0.5</alter><octave>4</octave></pitch><duration>1</duration></note>
  </measure></part></score-partwise>`;
  const { xml: out, warnings } = transposeMusicXml(quarter, E_TO_F);
  assert.match(out, /<alter>0.5<\/alter>/);
  assert.ok(warnings.some((w) => /microtonal/.test(w)));
});

test('a key signature past seven accidentals is respelled with a warning', () => {
  // A piece in Db that modulates to F# major (6 sharps), moved up to D: that
  // section would need 13 sharps, so it is respelled as G major instead.
  const sharp = '<score-partwise><part id="P1"><measure number="1"><attributes><key><fifths>6</fifths></key></attributes></measure></part></score-partwise>';
  const dbToD = buildTransposition(makeKey('Db'), makeKey('D'), 1);
  const { xml: out, warnings } = transposeMusicXml(sharp, dbToD);
  const fifths = parseInt(/<fifths>(-?\d+)<\/fifths>/.exec(out)[1], 10);
  assert.ok(fifths >= -7 && fifths <= 7);
  assert.ok(warnings.some((w) => /respelled/.test(w)));
});
