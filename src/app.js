/** UI layer. All music decisions live in the modules; this file only wires. */

import {
  makeKey, parseKey, keyName, keyLabel, keyFifths, spellKey, pitchClass,
  buildTransposition, describeSemitones, noteName, midiToNote, mod,
} from './theory.js';
import { analyzeSheet, transposeSheet } from './sheet.js';
import { detectKey } from './detect.js';
import { inspectMusicXml, transposeMusicXml } from './musicxml.js';
import { inspectMidi, transposeMidi } from './midi.js';
import { readMxl } from './mxl.js';
import { VOICE_PRESETS, toMidi, describeRange, rankShifts, shiftedKey } from './range.js';

const SAMPLE = `{title: Amazing Grace}
{key: E}

[Verse 1]
E                 E7        A            E
Amazing grace how sweet the sound that saved a wretch like me
E                       C#m       B7
I once was lost, but now am found, was
E        A        E   B7   E
blind but now I see

[Verse 2]
E                  E7         A           E
'Twas grace that taught my heart to fear, and grace my fears relieved
E                     C#m          B7
How precious did that grace appear the
E        A       E   B7   E
hour I first believed`;

const state = {
  kind: 'text',            // text | musicxml | midi
  filename: null,
  text: SAMPLE,
  xml: null,
  midiBytes: null,
  sourceKey: null,
  sourceLocked: false,
  semitones: 1,
  octaves: 0,
  prefer: 'auto',
  simplify: true,
  nashville: false,
  overrides: {},
  tab: 'result',
  singerLow: null,
  singerHigh: null,
  songLow: null,
  songHigh: null,
  songRangeFromFile: false,
  fileWarnings: [],
};

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, kids = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) node.append(k);
  return node;
};

/* ------------------------------------------------------------- derive --- */

/** Everything downstream of the current inputs, recomputed on every render. */
function derive() {
  const analysis = state.kind === 'text' ? analyzeSheet(state.text, state.overrides) : null;

  let detected = null;
  if (analysis) {
    detected = detectKey(analysis.chords, analysis.declaredKey);
  } else if (state.kind === 'musicxml' && state.xml) {
    const info = inspectMusicXml(state.xml);
    if (info.fifths !== null) detected = { key: keyFromFifths(info.fifths, info.mode), confidence: 1, source: 'file' };
  } else if (state.kind === 'midi' && state.midiBytes) {
    const info = inspectMidi(state.midiBytes);
    if (info.fifths !== null) detected = { key: keyFromFifths(info.fifths, info.mode), confidence: 1, source: 'file' };
  }

  const sourceKey = state.sourceKey ?? detected?.key ?? makeKey('C');
  const total = state.semitones + state.octaves * 12;
  const hint = keyFifths(sourceKey);
  const targetKey = spellKey(mod(pitchClass(sourceKey.tonic) + total, 12), sourceKey.mode, state.prefer, hint);
  const t = buildTransposition(sourceKey, targetKey, total);

  return { analysis, detected, sourceKey, targetKey, transposition: t, total };
}

function keyFromFifths(fifths, mode) {
  const order = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const index = Math.max(-7, Math.min(13, fifths)) + 1;
  let letter;
  let alter = 0;
  if (index >= 0 && index < 7) letter = order[index];
  else if (index >= 7) { letter = order[index - 7]; alter = 1; }
  else { letter = order[index + 7]; alter = -1; }
  return { tonic: { letter, alter, octave: null }, mode: mode === 'minor' ? 'minor' : 'major' };
}

/** "E major — 4 sharps (F# C# G# D#)" */
function signatureLine(key) {
  const fifths = keyFifths(key);
  if (fifths === 0) return 'no sharps or flats';
  const sharps = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const flats = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  const n = Math.abs(fifths);
  const names = (fifths > 0 ? sharps : flats).slice(0, Math.min(n, 7)).map((l) => l + (fifths > 0 ? '♯' : '♭'));
  return `${n} ${fifths > 0 ? 'sharp' : 'flat'}${n === 1 ? '' : 's'} · ${names.join(' ')}`;
}

/* ------------------------------------------------------------ render --- */

function render() {
  const d = derive();
  renderControls(d);
  renderSheet(d);
  renderVoice(d);
}

function renderControls(d) {
  const { sourceKey, targetKey, total, detected } = d;

  // The selects hold tonics only — the mode lives in its own control — so a
  // minor key must be matched by its tonic, not by "Am".
  $('#source-key').value = noteName(sourceKey.tonic, { withOctave: false });
  $('#source-mode').value = sourceKey.mode;
  $('#target-key').value = noteName(targetKey.tonic, { withOctave: false });
  $('#semitone-readout').innerHTML =
    `<b>${total > 0 ? '+' : ''}${total}</b><span>${describeSemitones(total).replace(/ \(.*\)$/, '')}</span>`;
  $('#octave-readout').textContent = state.octaves === 0 ? '±0' : (state.octaves > 0 ? `+${state.octaves}` : `${state.octaves}`);

  $('#source-sig').textContent = signatureLine(sourceKey);
  $('#target-sig').textContent = `${keyLabel(targetKey)} · ${signatureLine(targetKey)}`;

  const src = detected?.source;
  $('#detect-note').textContent = state.sourceLocked
    ? 'Set by you.'
    : src === 'declared' ? 'From the {key} line in the file.'
      : src === 'file' ? 'From the file’s key signature.'
        : detected ? `Detected from the chords${detected.confidence < 0.15 ? ' — low confidence, check it' : ''}.`
          : 'No chords found yet.';

  for (const chip of document.querySelectorAll('[data-prefer]')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.prefer === state.prefer));
  }
  $('#opt-simplify').checked = state.simplify;
  $('#opt-nashville').checked = state.nashville;

  // A capo is the guitarist's version of this transposition, and only works upward.
  const capo = mod(total, 12);
  $('#capo-hint').textContent = state.kind !== 'text' || capo === 0
    ? ''
    : `Guitarists: keep playing the ${keyName(sourceKey)} shapes with a capo on fret ${capo}.`;
}

function renderSheet(d) {
  const { analysis, transposition, sourceKey, targetKey, total } = d;
  const out = $('#output');
  out.replaceChildren();
  const notes = [];

  if (state.kind === 'text') {
    const result = transposeSheet(analysis, transposition, {
      simplify: state.simplify,
      nashville: state.nashville,
      nashvilleKey: sourceKey,
    });
    $('#stat-chords').textContent = analysis.chords.length;
    $('#stat-format').textContent = analysis.format === 'chordpro' ? 'ChordPro' : 'Chords over lyrics';

    const pre = el('pre', { className: 'sheet' });
    result.lines.forEach((line, i) => {
      const row = el('span', { className: 'ln' + (line.type === 'chords' ? ' is-chords' : '') });
      if (line.type === 'chords' || line.type === 'lyric') {
        row.classList.add('clickable');
        row.tabIndex = 0;
        row.title = line.type === 'chords'
          ? 'Read as a chord line — click to treat it as lyrics instead'
          : 'Read as lyrics — click to treat it as a chord line instead';
        const flip = () => {
          state.overrides[i] = line.type === 'chords' ? 'lyric' : 'chords';
          render();
        };
        row.addEventListener('click', flip);
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
      }
      for (const seg of line.segments) {
        row.append(seg.kind === 'plain' ? seg.text : el('span', { className: seg.kind, textContent: seg.text }));
      }
      row.append('\n');
      pre.append(row);
    });
    out.append(el('div', { className: 'sheet-scroll' }, pre));
    notes.push(...analysis.warnings.map((w) => ({ kind: 'warn', text: w })));
    state.resultText = result.text;

    if (state.octaves !== 0) {
      notes.push({
        kind: 'info',
        text: 'Chord names carry no octave, so the octave control leaves this chart unchanged. It only affects MusicXML and MIDI. To make a song easier to sing, change the key instead.',
      });
    }
  } else if (state.kind === 'musicxml') {
    const result = transposeMusicXml(state.xml, transposition, { simplify: state.simplify });
    state.resultText = result.xml;
    state.resultName = (state.filename || 'score').replace(/\.(mxl|musicxml|xml)$/i, '') + `-${keyName(targetKey)}.musicxml`;
    $('#stat-chords').textContent = result.notesMoved;
    $('#stat-format').textContent = 'MusicXML score';
    out.append(fileResultCard(`${result.notesMoved} notes moved`, 'Download the transposed score and open it in MuseScore, Sibelius, Finale or Dorico.'));
    notes.push(...result.warnings.map((w) => ({ kind: 'warn', text: w })));
  } else if (state.kind === 'midi') {
    const fifthsDelta = keyFifths(targetKey) - keyFifths(sourceKey);
    const result = transposeMidi(state.midiBytes, total, { fifthsDelta });
    state.resultBytes = result.bytes;
    state.resultName = (state.filename || 'song').replace(/\.midi?$/i, '') + `-${keyName(targetKey)}.mid`;
    $('#stat-chords').textContent = result.notesMoved;
    $('#stat-format').textContent = 'MIDI file';
    out.append(fileResultCard(`${result.notesMoved} note events moved`, 'Drums on channel 10 are left where they are.'));
    notes.push(...result.warnings.map((w) => ({ kind: 'warn', text: w })));
  }

  $('#stat-from').textContent = keyLabel(sourceKey);
  $('#stat-to').textContent = keyLabel(targetKey);
  $('#stat-move').textContent = total === 0 ? 'unchanged' : describeSemitones(total);

  notes.push(...state.fileWarnings.map((w) => ({ kind: 'bad', text: w })));
  const notesBox = $('#notes');
  notesBox.replaceChildren(...notes.map((n) => el('p', { className: `note ${n.kind === 'warn' ? '' : n.kind}`, textContent: n.text })));
  notesBox.hidden = notes.length === 0;

  $('#btn-download').hidden = state.kind === 'text';
  $('#btn-copy').hidden = state.kind !== 'text';
}

function fileResultCard(headline, detail) {
  return el('div', { className: 'verdict fits' }, [
    el('p', { className: 'headline', innerHTML: `<b>${headline}</b>` }),
    el('p', { className: 'hint', textContent: detail }),
  ]);
}

/* ------------------------------------------------------ voice finder --- */

const KEYBOARD_LOW = 36;   // C2
const KEYBOARD_HIGH = 84;  // C6
const IS_BLACK = (m) => [1, 3, 6, 8, 10].includes(mod(m, 12));

function whiteIndex(midi) {
  let n = 0;
  for (let m = KEYBOARD_LOW; m < midi; m += 1) if (!IS_BLACK(m)) n += 1;
  return n;
}
const TOTAL_WHITE = whiteIndex(KEYBOARD_HIGH + 1);

/** Horizontal position of a pitch, as a percentage across the keyboard. */
function xPercent(midi) {
  const clamped = Math.max(KEYBOARD_LOW, Math.min(KEYBOARD_HIGH, midi));
  const i = IS_BLACK(clamped) ? whiteIndex(clamped) - 0.5 : whiteIndex(clamped);
  return (i / TOTAL_WHITE) * 100;
}

function buildKeyboard() {
  const board = $('#keyboard');
  board.replaceChildren();
  const w = 100 / TOTAL_WHITE;
  for (let m = KEYBOARD_LOW; m <= KEYBOARD_HIGH; m += 1) {
    if (IS_BLACK(m)) {
      board.append(el('div', {
        className: 'black',
        style: `left:${xPercent(m) + w * 0.18}%;width:${w * 0.64}%`,
      }));
    } else {
      board.append(el('div', {
        className: 'white',
        style: `left:${xPercent(m)}%;width:${w}%`,
      }));
      if (mod(m, 12) === 0) {
        board.append(el('div', {
          className: 'octave-label',
          style: `left:${xPercent(m) + w * 0.12}%`,
          textContent: 'C' + (Math.floor(m / 12) - 1),
        }));
      }
    }
  }
}

function renderVoice(d) {
  const { sourceKey, total } = d;
  const board = $('#keyboard');
  for (const b of board.querySelectorAll('.band')) b.remove();

  const bands = [];
  if (state.singerLow !== null && state.singerHigh !== null && state.singerHigh > state.singerLow) {
    bands.push(['singer', state.singerLow, state.singerHigh]);
  }
  if (state.songLow !== null && state.songHigh !== null) {
    bands.push(['before', state.songLow, state.songHigh]);
    bands.push(['after', state.songLow + total, state.songHigh + total]);
  }
  for (const [cls, lo, hi] of bands) {
    const left = xPercent(lo);
    const right = xPercent(hi) + (100 / TOTAL_WHITE);
    board.append(el('div', { className: `band ${cls}`, style: `left:${left}%;width:${Math.max(1, right - left)}%` }));
  }

  $('#song-range-text').textContent = describeRange(state.songLow, state.songHigh);
  $('#singer-range-text').textContent = describeRange(state.singerLow, state.singerHigh);

  const verdict = $('#verdict');
  const list = $('#shift-options');
  list.replaceChildren();

  const ranked = rankShifts({
    songLow: state.songLow, songHigh: state.songHigh,
    singerLow: state.singerLow, singerHigh: state.singerHigh,
  });

  if (!ranked) {
    verdict.className = 'verdict';
    verdict.replaceChildren(
      el('p', { className: 'headline', textContent: 'Fill in both ranges to get a recommendation.' }),
      el('p', {
        className: 'hint',
        textContent: state.songRangeFromFile
          ? 'The song’s range came from your file. Add the singer’s comfortable low and high notes.'
          : 'Enter the lowest and highest notes of the melody, and the singer’s comfortable low and high notes. Upload a MusicXML or MIDI file and the song’s range is read automatically.',
      }),
    );
    return;
  }

  const best = ranked.best;
  const targetForBest = shiftedKey(sourceKey, best.semitones, state.prefer, keyFifths(sourceKey));
  verdict.className = 'verdict' + (best.fits ? ' fits' : '');
  verdict.replaceChildren(
    el('p', {
      className: 'headline',
      innerHTML: best.semitones === 0
        ? `Already the best fit — leave it in <b>${keyLabel(sourceKey)}</b>.`
        : `Sing it in <b>${keyLabel(targetForBest)}</b> — ${describeSemitones(best.semitones)}.`,
    }),
    el('p', {
      className: 'hint',
      textContent: ranked.impossible
        ? `The melody spans ${ranked.songSpan} semitones but this range covers ${ranked.singerSpan}. No key fits the whole song; this is the closest, and ${best.headroomTop < 0 ? `${-best.headroomTop} note(s) still sit above the ceiling` : `${-best.headroomBottom} note(s) still sit below the floor`}.`
        : `Leaves ${best.headroomTop} semitone${best.headroomTop === 1 ? '' : 's'} of room above the highest note and ${best.headroomBottom} below the lowest.`,
    }),
  );

  for (const option of ranked.options.slice(0, 5)) {
    const key = shiftedKey(sourceKey, option.semitones, state.prefer, keyFifths(sourceKey));
    const row = el('div', { className: 'option-row' }, [
      el('span', { className: 'shift', textContent: `${option.semitones > 0 ? '+' : ''}${option.semitones}` }),
      el('span', {}, [
        el('b', { textContent: keyLabel(key), style: 'font-weight:500' }),
        el('span', { className: 'rng', textContent: '  ' + describeRange(option.low, option.high) }),
      ]),
      el('span', { className: 'tag' + (option.fits ? ' ok' : ''), textContent: option.fits ? 'fits' : 'tight' }),
    ]);
    const apply = el('button', { className: 'btn small', textContent: 'Use' });
    apply.addEventListener('click', () => {
      state.octaves = Math.trunc(option.semitones / 12);
      state.semitones = option.semitones - state.octaves * 12;
      render();
      document.querySelector('.workbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    row.append(apply);
    list.append(row);
  }
}

/* -------------------------------------------------------------- input --- */

async function loadFile(file) {
  state.filename = file.name;
  state.fileWarnings = [];
  state.overrides = {};
  state.sourceKey = null;
  state.sourceLocked = false;
  const lower = file.name.toLowerCase();

  try {
    if (lower.endsWith('.mid') || lower.endsWith('.midi')) {
      state.midiBytes = new Uint8Array(await file.arrayBuffer());
      const info = inspectMidi(state.midiBytes);
      state.kind = 'midi';
      state.songLow = info.lowMidi; state.songHigh = info.highMidi; state.songRangeFromFile = true;
    } else if (lower.endsWith('.mxl') || lower.endsWith('.musicxml') || lower.endsWith('.xml')) {
      state.xml = lower.endsWith('.mxl') ? await readMxl(await file.arrayBuffer()) : await file.text();
      const info = inspectMusicXml(state.xml);
      state.kind = 'musicxml';
      state.songLow = info.lowMidi; state.songHigh = info.highMidi; state.songRangeFromFile = true;
      if (info.keyChanges) state.fileWarnings.push('This score changes key part-way through. Every section is moved by the same interval, which keeps the music correct.');
    } else if (lower.endsWith('.pdf') || /\.(png|jpe?g|gif|webp|heic|tiff?)$/.test(lower)) {
      state.fileWarnings.push('A PDF or photo of sheet music can’t be transposed here — there are no notes in the file, only a picture of them. Open it in MuseScore (which can scan simple scores), or export MusicXML from wherever the score came from, then bring that back here.');
      render();
      return;
    } else {
      state.kind = 'text';
      state.text = await file.text();
      state.songRangeFromFile = false;
      $('#editor').value = state.text;
    }
  } catch (error) {
    state.fileWarnings.push(`${file.name} could not be read: ${error.message}`);
  }
  syncSongRangeInputs();
  render();
}

function syncSongRangeInputs() {
  $('#song-low').value = state.songLow === null ? '' : noteName(midiToNote(state.songLow));
  $('#song-high').value = state.songHigh === null ? '' : noteName(midiToNote(state.songHigh));
}

function download(name, data, type) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------------------------------------------------- listeners --- */

function populateKeySelects() {
  // Circle of fifths, sharps then flats — how musicians actually scan a key list.
  const ordered = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'];
  for (const id of ['#source-key', '#target-key']) {
    const select = $(id);
    select.replaceChildren(...ordered.map((n) => el('option', { value: n, textContent: n })));
  }
  $('#voice-preset').replaceChildren(
    el('option', { value: '', textContent: 'Choose a voice…' }),
    ...VOICE_PRESETS.map((p) => el('option', { value: p.id, textContent: `${p.label} (${p.low}–${p.high})` })),
  );
}

function setSource(key) {
  state.sourceKey = key;
  state.sourceLocked = true;
  render();
}

function wire() {
  $('#step-down').addEventListener('click', () => { state.semitones -= 1; normaliseSemitones(); render(); });
  $('#step-up').addEventListener('click', () => { state.semitones += 1; normaliseSemitones(); render(); });
  $('#oct-down').addEventListener('click', () => { state.octaves -= 1; render(); });
  $('#oct-up').addEventListener('click', () => { state.octaves += 1; render(); });
  $('#reset').addEventListener('click', () => { state.semitones = 0; state.octaves = 0; render(); });

  $('#source-key').addEventListener('change', (e) => {
    setSource(makeKey(e.target.value, $('#source-mode').value));
  });
  $('#source-mode').addEventListener('change', (e) => {
    const current = derive().sourceKey;
    setSource(makeKey(noteName(current.tonic, { withOctave: false }), e.target.value));
  });
  $('#target-key').addEventListener('change', (e) => {
    const source = derive().sourceKey;
    const wanted = parseKey(e.target.value);
    const up = mod(pitchClass(wanted.tonic) - pitchClass(source.tonic), 12);
    state.semitones = up > 6 ? up - 12 : up;   // pick the shorter journey
    render();
  });

  for (const chip of document.querySelectorAll('[data-prefer]')) {
    chip.addEventListener('click', () => { state.prefer = chip.dataset.prefer; render(); });
  }
  $('#opt-simplify').addEventListener('change', (e) => { state.simplify = e.target.checked; render(); });
  $('#opt-nashville').addEventListener('change', (e) => { state.nashville = e.target.checked; render(); });

  const editor = $('#editor');
  editor.value = state.text;
  editor.addEventListener('input', () => {
    state.kind = 'text';
    state.text = editor.value;
    state.overrides = {};
    state.fileWarnings = [];
    render();
  });

  for (const button of document.querySelectorAll('[data-tab]')) {
    button.addEventListener('click', () => {
      state.tab = button.dataset.tab;
      for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b === button));
      $('#pane-source').hidden = state.tab !== 'source';
      $('#pane-result').hidden = state.tab !== 'result';
    });
  }

  $('#file').addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); });
  const drop = $('#drop');
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('over'); });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  }
  drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

  $('#btn-copy').addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(state.resultText ?? '');
    const button = e.currentTarget;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = 'Copy chart'; }, 1400);
  });
  $('#btn-download').addEventListener('click', () => {
    if (state.kind === 'midi') download(state.resultName, state.resultBytes, 'audio/midi');
    else if (state.kind === 'musicxml') download(state.resultName, state.resultText, 'application/vnd.recordare.musicxml+xml');
  });
  $('#btn-print').addEventListener('click', () => window.print());
  $('#btn-sample').addEventListener('click', () => {
    state.kind = 'text'; state.text = SAMPLE; state.overrides = {}; state.fileWarnings = [];
    state.sourceKey = null; state.sourceLocked = false; state.songRangeFromFile = false;
    editor.value = SAMPLE;
    render();
  });

  $('#voice-preset').addEventListener('change', (e) => {
    const preset = VOICE_PRESETS.find((p) => p.id === e.target.value);
    if (!preset) return;
    state.singerLow = toMidi(preset.low);
    state.singerHigh = toMidi(preset.high);
    $('#singer-low').value = preset.low;
    $('#singer-high').value = preset.high;
    render();
  });
  const bindNote = (id, field) => $(id).addEventListener('input', (e) => {
    state[field] = toMidi(e.target.value.trim());
    e.target.setAttribute('aria-invalid', String(e.target.value.trim() !== '' && state[field] === null));
    render();
  });
  bindNote('#singer-low', 'singerLow');
  bindNote('#singer-high', 'singerHigh');
  bindNote('#song-low', 'songLow');
  bindNote('#song-high', 'songHigh');

  $('#theme').addEventListener('click', () => {
    const now = document.documentElement.getAttribute('data-theme');
    const next = now === 'dark' ? 'light' : now === 'light' ? 'dark'
      : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', next);
    $('#theme').setAttribute('aria-label', `Switch to ${next === 'dark' ? 'light' : 'dark'} theme`);
  });
}

/** Keep the semitone control inside one octave; whole octaves live in their
 *  own control, so the two never quietly duplicate each other. */
function normaliseSemitones() {
  if (state.semitones > 11) { state.semitones -= 12; state.octaves += 1; }
  if (state.semitones < -11) { state.semitones += 12; state.octaves -= 1; }
}

populateKeySelects();
buildKeyboard();
wire();
render();
