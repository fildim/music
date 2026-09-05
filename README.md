# Singable Key

**Live: https://fildim.github.io/music/**
&nbsp;·&nbsp; [single-file copy](https://fildim.github.io/music/standalone.html) (save it, works offline)

A browser tool for moving a song into a key someone can actually sing.

Point it at a chord sheet, a MusicXML score or a MIDI file, choose a new key,
and every chord, note, key signature and printed accidental is respelled
properly. No build step, no dependencies, no server — everything runs locally in
the page, and nothing you open is uploaded.

## The thing most transposers get wrong

Transposition is an **interval**, not a pitch-class lookup.

A pitch-class transposer moving a song from E to F gets the tonic right and then
spells the `A` chord as `A#`. There is no A# in F major. The correct answer is
`Bb`, and you only get it by moving the *letter* and the *pitch* as two separate
steps: E→F is up one letter and up one semitone, so A→B and 9→10, giving `Bb`.

That single rule drives everything here: chord roots, slash-chord bass notes,
MusicXML `<pitch>` elements and key signatures all move the same way.

Where strict interval transposition produces something awkward — `Bb` in E major
becomes `Cb` in F major — the result is simplified to `B`, but **only when the
note is not part of the target key**. `E#` really is the seventh degree of F#
major and is left alone. That guard is what separates "helpfully tidy" from
"quietly wrong".

## Key or octave?

These are different things, and mixing them up is the usual reason a song still
doesn't fit a voice:

| | |
|---|---|
| **Key** | E → F is **+1 semitone**. Different chords, roughly the same pitch height. This is what makes a song fit a voice. |
| **Octave** | **12 semitones**. The same notes, higher or lower. On a chord chart it changes nothing at all, because chord names carry no octave. |

The app keeps them as separate controls and says so on screen.

## What it reads

| Format | Extensions | Notes |
|---|---|---|
| Chord sheets | `.txt` `.md` `.pro` `.chordpro` `.crd` `.cho` | Chords above lyrics, or ChordPro `[C]` brackets |
| MusicXML | `.musicxml` `.xml` `.mxl` | Notes, key signatures, accidentals and chord symbols |
| MIDI | `.mid` `.midi` | Note events and the key-signature meta event |

**Not** PDFs or photos of sheet music. Those contain a picture of notes, not
notes. Export MusicXML from MuseScore, Finale, Dorico or Sibelius first.

## Deciding what is a chord

For chord sheets the hard problem isn't transposition, it's telling a chord line
from a lyric line. A permissive parser reads `Bad` as B-add and `Cage` as C-aug,
and then rewrites the words in someone's song.

So the text after a root note is matched against a closed grammar
(`quality := base? extension*`). `Bad` → root `B`, remainder `ad`: `a` is not a
base and `ad` is not `add`, so it is not a chord. `Cage`, `Face`, `Amen`,
`Golden`, `Around`, `Chorus`, `Bridge` and `Verse` all fail the same way.

A line is treated as chords only when *every* token on it is a chord or a bar
line. Genuinely ambiguous readings — `Go` parses as G-diminished — are marked
weak and default to lyrics. And because no heuristic is perfect, **clicking any
line in the output flips it** between chords and lyrics.

## Keeping the alignment

Chord names change width. `A` → `Bb` is one character wider, so a naive
find-and-replace slides every later chord off the syllable it belongs to.

Each chord is re-anchored to the column it started on, and only pushed right when
the previous chord genuinely overruns it:

```
E                 E7        A            E
Amazing grace how sweet the sound that saved a wretch like me
↓
F                 F7        Bb           F
Amazing grace how sweet the sound that saved a wretch like me
```

## Finding the right key for a voice

Enter the singer's comfortable low and high notes and the melody's range (read
automatically from MusicXML and MIDI), and every transposition is ranked by fit.
Running out of room at the top is weighted more heavily than at the bottom — a
note above someone's ceiling is a note they cannot sing.

If the melody is simply wider than the singer's range, it says so rather than
pretending some key will fix it.

## Also in there

- **Capo hint** — the fret that gets a guitarist to the new key from the old shapes.
- **Nashville numbers** — degrees instead of chord names, with conventional
  spelling (`b7`, not `#6`).
- **Sharp / flat preference**, and key names chosen by key-signature complexity,
  so a pitch class of 10 is `Bb` (2 flats) rather than `A#` (10 sharps).
- **Print stylesheet** — the chart alone, chords in bold black.

## Deliberate limitations

- **Guitar tablature is left untouched.** Moving tab means re-fingering it, not
  renaming it, so tab lines and `{start_of_tab}` blocks pass through unchanged.
- **Percussion is left untouched.** MIDI channel 10 and MusicXML `<unpitched>`
  notes are skipped — drums have no key.
- **`{capo:}` directives are left as they are.** Transposing the written chords
  while keeping the capo is exactly what shifts the sounding key; rewriting the
  capo would undo the transposition.
- **MIDI notes that would fall outside 0–127 keep their original pitch** and are
  reported, rather than being clamped to a wrong note.
- **`.mxl` is read but written back as plain `.musicxml`**, which every notation
  program opens.

## Running it

Open `index.html` in a browser. That's it — no install, no build.

```bash
npm test          # 70 tests, no dependencies (node:test)
node build.js     # bundles everything into dist/index.html as a single file
```

## Publishing it

`.github/workflows/pages.yml` runs the tests, builds the bundle and deploys to
GitHub Pages on every push. The published site carries both the modular app and
`standalone.html`, a single self-contained file that works offline.

Pages has to be switched on once by hand — a workflow's own token is not
permitted to create the site. In the repository go to **Settings → Pages →
Build and deployment** and set **Source** to **GitHub Actions**. After that
every push deploys on its own.

## Layout

```
index.html          markup
assets/styles.css   styles
src/theory.js       pitch model, intervals, keys, spelling
src/chords.js       chord symbol grammar, parsing, Nashville numbers
src/sheet.js        line classification, ChordPro, alignment
src/detect.js       key detection from a chord list
src/musicxml.js     MusicXML transposition
src/midi.js         Standard MIDI File transposition
src/mxl.js          .mxl (zipped MusicXML) reader
src/range.js        vocal range fitting
src/app.js          UI wiring
test/               unit tests for all of the above
build.js            single-file bundler
```

## Licence

MIT — see [LICENSE](LICENSE).
