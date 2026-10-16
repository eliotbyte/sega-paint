# Sega Paint tools for language models

Sega Paint (`player/`) is a Mega Drive music editor for people: mouse, canvas, sprites. This folder is the
same thing for a model: **text in, text out, and files Sega Paint already opens**. You write a song as text
(`.sps`), build it into a `song.json`, read a text report instead of listening, and hand the file to the
human, who opens it with **Import** in Sega Paint. Sounds work the same way: an FM patch as text (`.spp`),
numbers instead of ears, and a `.spsound` file the human drags onto the Sega Paint window.

Run everything from the repository root with Node 22.7+ (or 20.19+ on Node 20; no npm install). The tools load
the app's `.js` modules, which Node tells apart by their syntax only from those versions on; an older Node gets
a one-line message saying so.

```
node llm/sp.mjs help              # all commands
node llm/sp.mjs help <command>    # one command in detail
```

Below, `sp` means `node llm/sp.mjs`. Put drafts, WAVs and other scratch files in `llm/out/` (git ignores it).
**Never edit anything in `player/`**: the app must stay as it is.
Working examples in `llm/examples/`: `night-ride.sps` (small), `neon-alley.sps` (4 parts), `dusk-run.sps` (30 s, uses its own bass `pluck-bass.spp` / `.spsound`), `soft-pad.spp`.

## The chip in one paragraph

The Mega Drive has a YM2612 (6 FM channels) and an SN76489 (PSG: 3 square waves + 1 noise). Sega Paint
gives you 13 **voices**, each plays **one note at a time**:

| voice | plays | notes |
|---|---|---|
| `FM1`-`FM5` | FM sounds (`fm`), or FM drums (`drums`) | FM6 is taken by the DAC. A voice is either melodic or a drum kit, not both |
| `PSG1`-`PSG3` | square waves (`psg`) | lowest note A2; mono (no pan) |
| `NOISE` | noise (`noise`) | no pitch: hits only |
| `DAC1`-`DAC3` | samples (`samples`) at their own pitch | drums, hits, vocal shots |
| `DAC4` | pitched samples that follow the note | only DAC4 changes a sample's pitch |

All four DAC voices are mixed into FM6; samples have no volume and no pan.

## Commands

| command | what it does |
|---|---|
| `sp sounds [--game X] [--kind fm\|drums\|psg\|noise\|samples] [--find word]` | the sound library: key, name, kind, voices, range |
| `sp build song.sps [out.json]` | `.sps` to a `song.json` for Import; runs `check` too |
| `sp check song.json\|song.sps` | hardware rules in words: errors and warnings |
| `sp listen song.sps\|song.json [--bars 1-16] [--roll 1-8] [--all] [--no-render]` | text report: piano roll, chords, key, clashes, voice load, loudness |
| `sp render song.json\|song.sps [out.wav] [--from bar] [--bars N] [--solo FM1,DAC2]` | WAV through the real engine (for a human, or for `hear`) |
| `sp import song.json [out.sps]` | a song (game track or Sega Paint export) back to `.sps` |
| `sp patch get <key\|x.spsound> [out.spp]` | a library FM sound as a `.spp` text patch |
| `sp patch explain x.spp\|<key>` | a patch in words: who modulates whom, depth, envelopes, measured sound |
| `sp patch save x.spp [--name N] [out.spsound]` | a `.spsound` the human drops on Sega Paint (goes to My sounds) |
| `sp hear x.spp\|<key>\|x.spsound\|target.wav [--notes A2,A4] [--hold 1s] [--png] [--wav]` | one sound in numbers: attack, decay, release, brightness, harmonics |
| `sp compare x.spp\|<key> target.wav\|<key> [--note A2] [--hold 1s]` | differences in words + one distance (0 = same, ~1 = clearly different) |
| `sp nearest target.wav\|x.spp\|<key> [--n 5] [--kit my.spkit] [--note A2] [--hold 1s]` | the library FM sounds closest to a target |
| `sp fit x.spp\|<key> target.wav\|<key> [out.spp] [--free tl,env] [--budget N] [--time S]` | search the free numbers of a patch towards a target |

Default outputs: `build` writes the `.json` next to the `.sps`; `render`, `import`, `patch get/save`, `fit`
write to `llm/out/<name>.*`. Careful: `sp import llm/out/song.json` writes `llm/out/song.sps` and so
overwrites the `.sps` you built it from; give it another out path. A sound key looks like `Skitchin':f0` (game, colon, id); copy it from `sp sounds`.

## The song notation (.sps)

```
# night.sps: everything after " #" is a comment
song "Night Ride"  bpm 140  4/4  grid 16    # grid = steps per bar (16 = sixteenths)
base skitchin                                # the game whose sample bank the song uses
key A minor                                  # optional; listen checks notes against it

sound bass  = "Skitchin':f0"                 # name = library key (sp sounds)
sound hat   = "Skitchin':d42"
sound kick  = "Skitchin':s16c225"
sound snare = "Skitchin':s16cadc"
sound gtr   = "Skitchin':s168b9e"
sound sq    = "Skitchin':p0"

track FM1 "Bass"                             # optional track names

pattern groove 1:                            # name, length in bars
  FM1  bass : A2/2 -/2 A2/2 C3/2 | E3/4 D3/4
  FM1  vol 12 at 5                           # vol / pan / slide lines
  DAC4 gtr  : A3/4 -/4 A3/4 G3/4
  DAC1 kick : x... ..x. x.x. ....
  DAC1 snare: .... x... .... x...            # two lines of one voice are merged
  FM2  hat  : x.x. x.x. x.x. x.x.

pattern lead 2:
  PSG1 sq   : A4/4 C5/4 E5/4 D5/4 | C5/8 B4/8
  FM1  bass : A2/16 | F2/16

section verse  = groove x3, groove +5        # x3 = three times, +5 = up 5 semitones
section chorus = lead, groove x2
arrange: verse chorus verse chorus
loop: chorus                                 # where the game loop starts (or: loop bar 5 / loop off)
```

**Header** (top-level lines, any order): `song "Title"`, `bpm 20..400`, `4/4` (the only meter), `grid N`
(steps per bar, 1..64; 16 is the default and Sega Paint's own grid), `base <game>`, `key <root> <scale>`
(major, minor, dorian, mixolydian, phrygian, harmonic-minor, major-pent, minor-pent, blues),
`bars N` (force the song length).

**Sounds**: `sound name = "key"` with a library key, or a file next to the `.sps`: `"my-bass.spp"`
(a text patch), `"my-bass.spsound"`. A sound is copied into the song, so the `.json` needs nothing else.

**Pattern lines**: `VOICE sound : tokens`, indented under `pattern name bars:`.

- `A2`, `F#3`, `Bb4`: a note (C4 = middle C). `/N` = length in grid steps (default 1; `/1.5` works).
- `-/4`, `./4`, `r/4`: a rest of 4 steps.
- `x`: a hit, the sound's own note. A **drum string** like `x..x.x..` is one character per step
  (`x` hit, `.` or `-` silence). Drum voices (`DAC1-3`, `NOISE`, an FM drum track) take only hits.
- `|`: for the eye only (bars, beats). It is not checked: count your steps.
- Per-note attributes: `A2/2{vol=12}`, `{pan=L}`, `{slide=+2}` (semitones), combined `{vol=10,pan=R}`.
- Attribute lines: `FM1 vol 12` (every note of FM1 in this pattern), `FM1 vol 12 at 3,7` (notes starting at
  grid steps 3 and 7, counted from 1 in the pattern), `FM1 pan L from 9` (from step 9 on).
  `vol` 0..15 (15 = full) on FM / PSG / NOISE (on the PSG each step is ~2 dB: `vol 8` is already quiet); `pan` L|C|R on FM only; `slide` on FM and PSG notes.
- How fast `{slide=+N}` glides: from the note to N semitones away over the first 60 % of the note, at most
  0.25 s and at least 33 ms, in 60 Hz steps, then it holds the new pitch. A 1-beat note at 120 bpm (0.5 s)
  glides in 0.25 s, an eighth (0.25 s) in 0.15 s. A short, fast slide needs a short note; a slow one cannot
  take longer than 0.25 s. A slide replaces the pitch events of the sound's macro on that note.
- The notes of a line must fill at most the pattern (`bars x grid` steps); fewer is fine (the rest is silent).

**Arrangement**: `section name = item, item ...` where an item is a pattern or section name, then optional
`xN` (repeat) and `+N` / `-N` (transpose; drums are never transposed). `arrange:` lists what plays, in
order. Without `arrange:`, the sections play in order (or the patterns, if there are no sections).

**Loop**: `loop: chorus` or `loop bar 5` is where the repeat starts. Every Sega Paint song loops: `loop off`
(or no `loop` line) only means no loop point, and the song then repeats from bar 1 (`build` says
`no loop point`). Whether playback repeats at all is the player's Loop button, not the song.

Song length in seconds = bars x 4 x 60 / bpm. At 140 bpm a bar is 1.71 s: 16 bars is about 27 s.
The bars are the sum of the pattern lengths as `arrange:` expands them; `build` prints bars and seconds, check them.

**Imported songs**: `sp import` of a game track writes extra things you may leave alone: `{d=..}` (length in
samples), `{n=..}` (offset in samples), `{m=..}` (a macro), `song:i3/m40` sounds, and an `exact:` JSON block
at the end. Change the notes, keep the rest; the tempo of such a song cannot be changed in the `.sps`.

## The patch notation (.spp)

An FM sound: algorithm, feedback, four operators. Names and numbering are those of the FM editor of
Sega Paint (op1..op4 as shown there).

```
# soft-pad.spp
patch "Soft pad"  alg 4  fb 2  ams 0  fms 0
  op1  mul 1  dt +1  tl 40  ar 10  dr 4  sl 3  sr 0  rr 5  ks 0  am 0  ssg 0
  op2  mul 1  dt +2  tl 8   ar 12  dr 2  sl 2  sr 0  rr 5  ks 0  am 0  ssg 0
  op3  mul 2  dt -1  tl 45  ar 10  dr 4  sl 3  sr 0  rr 5  ks 0  am 0  ssg 0
  op4  mul 1  dt -2  tl 8   ar 12  dr 2  sl 2  sr 0  rr 5  ks 0  am 0  ssg 0
note C4
icon star
```

- `patch "Name"` (24 characters at most) `alg 0..7  fb 0..7  ams 0..3  fms 0..7`, optional `pan L|R`,
  `drum <General MIDI note 35..81>` (an FM drum).
- Operator fields: `mul 0..15` (frequency ratio; 0 = one half), `dt -3..3` (detune), `tl 0..127`
  (attenuation: 0 = loudest, 127 = silent), `ar 0..31` attack rate, `dr 0..31` decay rate, `sl 0..15`
  sustain level (0 = no drop), `sr 0..31` sustain-phase decay rate, `rr 0..15` release rate, `ks 0..3`
  key scaling, `am 0|1`, `ssg 0..8`. Higher rates are faster. `d1r`/`d2r`/`d1l` are accepted for `dr`/`sr`/`sl`.
  A field you leave out keeps its default (`tl 127`, i.e. silent, so write every operator in full).
- Carriers (the operators you hear) per algorithm: 0-3: op4; 4: op2, op4; 5-6: op2, op3, op4; 7: all four.
  The rest are modulators: lower `tl` = more modulation = brighter. `sp patch get` prints the links.
- `note A2`: the sound's own note (what `x` plays). `icon <sprite>`: the picture in Sega Paint.
  `note` does not move the pitch: a written `A3` asks the chip for A3 whatever `note` says.
- `patch get` may also write `macro`, `reg` and `keyon` lines (pitch events of a game sound); keep them as they are.
  `macro base 3/1288` is the pitch the macro's `f` (frequency) events are written for. The engine moves those
  events by (played note − base pitch), so they are relative to `macro base`, not to `note`. Changing the base
  moves every `f` event; changing `note` moves none.
- A patch can sound off the written note: a carrier at `mul 2` sounds an octave higher, a modulator that sets the
  fundamental (`mul 0`, or a `mul 1` modulator over a `mul 2` carrier) an octave lower. `hear` prints the pitch
  it measures, and `sp sounds` shows it for library sounds (Skitchin' `f0` Bass: "sounds an octave lower than
  written"). Write the notes that much the other way.
- `ams`, `fms` and `am` need the chip's LFO, and the LFO is off in every song (each base song sets register
  0x22 to 0, and a `.sps` cannot turn it on). In a song they do nothing: `fms` vibrato is silent. `hear`,
  `compare` and `fit` play patches the same way, so they show no vibrato either. For vibrato, use `{slide}`.

## Work loop: a song

1. `sp sounds` (and `sp sounds --kind fm`, `--find kick`): pick keys. Note each sample's pitched range
   (DAC4 only) and each sound's voices.
2. Write `llm/out/song.sps`: header, sounds, a few patterns, sections, `arrange:`.
3. `sp build llm/out/song.sps`: errors come as `file:line:col: message` plus a hint; fix and rebuild.
   The check runs after the build and prints `ok: no problems`, or warnings and errors.
4. `sp listen llm/out/song.json`: read the key, chords per bar, the HARMONY (out-of-key notes, clashes),
   LOAD (silent voices, empty bars) and SOUND (loudness per bar, clipping, buried voices) parts.
   A buried DAC voice cannot be turned up (samples have no volume): thin the voices over it or pick another sample.
   Use `--no-render` while you iterate on notes (the sound part renders every voice alone: ~30 s).
5. Fix the `.sps`, rebuild, listen again. `sp render llm/out/song.json` gives a WAV if a human wants one.
6. Tell the human: open `llm/out/song.json` in Sega Paint with **Import** (or drag it onto the window).
   If they edit it and export it, `sp import` brings it back to `.sps`.

## Work loop: a sound

1. Start near the goal. `sp nearest target.wav` (any WAV: another game, a recording) or think of a library
   sound (`sp sounds --kind fm`). Starting from a working patch beats starting from zero.
2. `sp patch get "Skitchin':f0" llm/out/bass.spp`, then `sp patch explain llm/out/bass.spp`.
3. Edit the `.spp`: you decide the structure (`alg`, `mul`, `dt`, `fb`). Then measure:
   `sp hear llm/out/bass.spp --notes A1,A2` (what it is) or `sp compare llm/out/bass.spp target.wav`
   (how it differs from a target, and a distance).
   `nearest`, `compare` and `fit` find where the key went up in a target WAV (where its level starts falling
   clearly faster); `nearest` and `compare` say where (`key-up at 0.75 s`). If that is wrong (a slow fade, a recording with reverb),
   set it: `--hold 0.75` (or `0.75s`, `750ms`). In `hear`, `--hold` is how long each note is held (default 1 s).
   They also measure the target's pitch and play the patch there. A chord sample, a hollow or a noisy sound
   has no single pitch: then they print `pitch X is a guess` with its strongest partials. If you know the note
   (the note the sample was played at), give it with `--note G#4`.
   `hear --png` / `--wav` write to `llm/out/` unless `--out pic.png` (or a folder, `--out dir/`) says where.
   `hear`, `compare`, `nearest` and `fit` take FM sounds (library FM sounds and FM drums, `.spp`, `.spsound`)
   and WAVs. A PSG, noise or sample sound is not a patch: put it in a 1-bar `.sps`, `sp render` it, and hear the WAV.
4. Optional: `sp fit llm/out/bass.spp target.wav llm/out/bass-fit.spp --free op2.tl,op4.dr,fb --time 30`
   moves the free numbers (default `tl,env`: every TL and envelope) while you keep the structure.
   `--free` takes `op1.tl`, `op3.dr`, `op2` (its TL and envelope), `tl` / `env` / `ar` ... (all operators), `fb ams fms`.
   When a carrier's TL is free, the level follows the target's. The chip's output is coarse (9 bits), so level
   changes the sound a little, and fit does not leave it for the end. Fit also keeps the patch harmonic: at most
   30 % of the sound off the harmonics, or more when the start patch (+ 5 %) or the target (+ 10 %) is noisier. Without that limit, a hissy 8-bit
   sample target turns the patch into noise. `--max-noise 0.5` allows more, `--max-noise 1` removes the
   limit; drums have none.
5. `sp patch save llm/out/bass.spp --name "Fat bass" llm/out/fat-bass.spsound`.
   Tell the human: drag the `.spsound` onto the Sega Paint window; it appears in **My sounds**.
6. To use the patch in a song, name the file in the `.sps`: `sound bass = "bass.spp"` (path relative to
   the `.sps`). The song then carries the patch itself.

Sound ideas in numbers: a pluck has a fast `ar` (31) and a fast modulator decay; a pad has a slow `ar` (8-14)
and a slow `rr`; brightness is the modulator `tl` (lower = brighter); `fb` on op1 adds buzz (5-7 = rough);
`mul 2`/`3` on a modulator adds even/odd overtones; detuning two carriers (`dt +2` / `dt -2`) makes it wide.

## Hardware rules and typical errors

`sp check` (and `build`) report these. Errors are things the chip or the app cannot do; warnings play,
but not as you probably meant.

| message (short) | what to do |
|---|---|
| `FM6 is not available` | FM6 plays the DAC: use FM1-FM5 |
| `two notes at once` | one voice, one note: move the second note to another voice (chords = several voices) |
| `the notes run past the end of "x"` | count the steps; make the pattern longer or the notes shorter |
| `DAC4 is the pitched sample voice and "X" has no pitch` | unpitched samples go on DAC1-DAC3 |
| `pitch changes only on DAC4` | DAC1-3 play a sample at its own pitch: write `x`, or move it to DAC4 |
| `... is out of the range of "X"` (DAC4) | each pitched sample has a range (`sp sounds`, e.g. C1-G#4): transpose |
| `too low for the PSG (lowest A2)` | PSG1-3 cannot go below A2: raise an octave or use FM |
| `volume out of 0-15` | `vol` is 0..15, 15 = full; PSG sounds have their own level (`sp sounds`: "volume 9/15") |
| `samples have no volume` | the DAC plays samples as they are: drop `vol` on DAC voices |
| `no pan` (PSG, DAC) | only FM voices pan |
| `slide works on FM and PSG notes` | no slide on drums or samples |
| `mixes FM drums and FM instruments` | an FM voice is a drum kit or melodic: use another FM voice |
| `NOISE has no pitch` / `fixed pitch` | write hits (`x`) on NOISE, DAC1-3 and FM drum voices |
| `off the staff (C1-C8)` (warning) | Sega Paint shows C1-C8; keep notes inside |
| `notes at or after the song end` (warning) | add bars, or `bars N` is too short |

Budget: 5 FM + 3 PSG + 1 noise + 4 DAC voices. A typical layout: FM1 bass, FM2 FM drums (hats, toms,
crash), FM3-FM5 lead / chords, DAC1 kick + snare, DAC4 a pitched sample (chords, guitar), PSG for arpeggios.

## Honest limits

- You do not hear: `listen` and `hear` are numbers. The chord names are guesses from the notes; trust the
  HARMONY lines more than the chord labels. Ask the human to listen before you call a song done.
- Renders are slow-ish: about 190 ms per note or bar render. `listen` with sound takes ~30 s for a
  16-bar song; `fit` runs hundreds of renders (it uses all cores and stops at `--time`, default 60 s).
- `fit` repeats a sound of another FM chip well; a live instrument only roughly ("similar in character").
  Keep `--free` small (5-10 parameters) and choose the structure yourself.
- Only 4/4. Tempo is constant in a `.sps` you write.
- The library is small (one game, Skitchin'): 3 FM instruments, 12 FM drums, 1 PSG, 1 noise and
  10 samples. Make your own FM sounds with `.spp` when you need more.
