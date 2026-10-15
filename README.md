# Sega Paint

A Mario Paint–style music toy for the Sega Mega Drive / Genesis sound: sprite notes on one staff, coloured tracks, and a real YM2612 + SN76489 sound running in the browser. Comes with the Skitchin' soundtrack to open, play and remix.

**Play online:** https://eliotbyte.github.io/sega-paint/

Version: beta 1.

## Run locally

```bash
python tools/serve.py
```

Then open http://localhost:8765. Any static server works for the music editor; `tools/serve.py` is needed for the resource editor.

## Resource editor

http://localhost:8765/art.html (or EDIT ART in Settings when running locally): the app's pixel art, track and interface colours, song pictures and Description pages. It saves through `tools/serve.py`, so it is not part of the online version.

## What is where

| Path | What |
|---|---|
| `player/` | The app: `index.html`, `app.js` (editor), `engine/` (YM2612, SN76489, VGM, playback) |
| `player/art/` | Pixel art, one PNG per picture, listed in `art.json`; colours in `palette.json` and `theme.json` |
| `player/songs/` | Songs in Sega Paint's format: `song.json`, `meta.json`, `samples.bin`; list in `index.json` |
| `player/library/` | The shared sound library: `sounds.json` + `samples.bin` |
| `tools/serve.py` | Local dev server, takes the resource editor's saves |

The example songs and sounds come from Skitchin' (Electronic Arts, 1994), converted to the app's format for study and play; they belong to their authors.
