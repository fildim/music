import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSheet, transposeSheet, expandTabs } from '../src/sheet.js';
import { makeKey, buildTransposition } from '../src/theory.js';

const E_TO_F = buildTransposition(makeKey('E'), makeKey('F'), 1);
const run = (text, t = E_TO_F, opts) => transposeSheet(analyzeSheet(text), t, opts).text;

test('chords stay over the syllable they started on when names change width', () => {
  const input = [
    'E                 A              B            E',
    'Amazing grace how sweet the sound that saved a wretch',
  ].join('\n');
  const out = run(input).split('\n');
  // A -> Bb is one character wider; every later chord must keep its column.
  assert.equal(out[0].indexOf('F'), 0);
  assert.equal(out[0].indexOf('Bb'), 18);
  assert.equal(out[0].indexOf('C'), 33);
  assert.equal(out[0].lastIndexOf('F'), 46);
  assert.equal(out[1], 'Amazing grace how sweet the sound that saved a wretch');
});

test('chords that get shorter stay anchored rather than sliding left', () => {
  const out = run('C#m       A\nsome words here').split('\n');
  assert.equal(out[0].indexOf('Dm'), 0);
  assert.equal(out[0].indexOf('Bb'), 10, 'still at column 10');
});

test('a chord that overruns pushes the next one right by the minimum', () => {
  // Two chords one space apart; the first grows, so the second must shift.
  const out = run('A B\nx').split('\n');
  assert.equal(out[0], 'Bb C');
});

test('lyric lines are never rewritten', () => {
  const input = 'Bad days come and go, but the cage stays\nA face in every crowd';
  assert.equal(run(input), input);
});

test('chordpro brackets transpose, section labels do not', () => {
  const input = '[Verse 1]\nI [E]once was [A]lost but [B7]now am [E]found';
  assert.equal(run(input), '[Verse 1]\nI [F]once was [Bb]lost but [C7]now am [F]found');
});

test('the key directive follows the transposition', () => {
  assert.equal(run('{key: E}'), '{key: F}');
  assert.equal(run('{title: Song in E}'), '{title: Song in E}', 'only the key directive changes');
});

test('capo directives are left alone', () => {
  // Transposing the written chords while keeping the capo is what shifts the
  // sounding key, so rewriting the capo would undo the transposition.
  assert.equal(run('{capo: 2}\nE A B'), '{capo: 2}\nF Bb C');
});

test('guitar tab is left untouched', () => {
  const tab = ['{start_of_tab}', 'e|---0---2---|', 'B|---1---3---|', '{end_of_tab}'].join('\n');
  assert.equal(run(tab), tab);
  const loose = 'E|--3--5--7--|';
  assert.equal(run(loose), loose, 'tab is recognised without directives too');
});

test('bar lines and repeat marks keep their place', () => {
  assert.equal(run('E   | A  | B  | E'), 'F   | Bb | C  | F');
  assert.equal(run('| E  E  A  B | x2'), '| F  F  Bb C | x2');
});

test('a wrong guess can be overridden per line', () => {
  const text = 'Go';
  assert.equal(run(text), 'Go', 'weak single-chord lines default to lyrics');
  const forced = transposeSheet(analyzeSheet(text, { 0: 'chords' }), E_TO_F).text;
  assert.equal(forced, 'Abo', 'forcing the line transposes it (Go = G diminished)');
  const asLyric = transposeSheet(analyzeSheet('E A B', { 0: 'lyric' }), E_TO_F).text;
  assert.equal(asLyric, 'E A B', 'and a chord line can be forced back to lyrics');
});

test('tabs expand to spaces so columns still line up', () => {
  assert.equal(expandTabs('a\tb'), 'a       b');
  assert.equal(expandTabs('12345678\tb'), '12345678        b');
  const analysis = analyzeSheet('E\tA\nsome words');
  assert.ok(analysis.warnings.some((w) => /Tab characters/.test(w)));
});

test('analysis reports what it found', () => {
  const a = analyzeSheet('{key: E}\nE A B\nlyrics here\nI [C]am chordpro');
  assert.equal(a.format, 'chordpro');
  assert.equal(a.declaredKey.tonic.letter, 'E');
  assert.equal(a.chords.length, 4);
  assert.deepEqual(a.lines.map((l) => l.type), ['directive', 'chords', 'lyric', 'chordpro']);
});

test('nashville rendering swaps chords for numbers', () => {
  const out = run('E A B7 C#m\nwords', E_TO_F, { nashville: true, nashvilleKey: makeKey('E') });
  assert.equal(out.split('\n')[0], '1 4 57 6m');
});
