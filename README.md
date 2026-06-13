# Tracks

A complete music-production studio that runs in your browser, free, with no
account and no install — live at **[tracks.jfound.net](https://tracks.jfound.net)**.
Multi-track arrangement, piano roll, built-in synths/drums/samplers, mic and
MIDI recording, mixer with EQ/dynamics/sends, autotune, stem extraction, and
WAV/MP3 export. Your projects never leave your device.

A standalone synthesizer lives at **[synth.jfound.net](https://synth.jfound.net)**
(same repo, `synth.html`, served by the `synth-jfound` worker).

## Features

- **Arrange** — multi-track timeline, piano roll with velocity, quantize, swing, tempo map, time signatures, markers, and a session/clip-launch view.
- **Instruments** — subtractive + FM synthesizer, 808/909 drum machines, a 16-pad sampler, and SoundFont (`.sf2`) playback.
- **Record** — capture mic input or a MIDI keyboard (Web MIDI), with count-in and take comping.
- **Mix** — per-track parametric EQ, compressor, gate, de-esser, reverb/delay sends, group buses, sidechain ducking, and automation of any parameter.
- **Vocals & audio** — built-in autotune, time-stretch/repitch, and stem extraction (drums/bass/vocals/other).
- **Export** — WAV and MP3 bounce, per-track stems, standard MIDI file, and a self-contained `.tracks.json` project file.

Everything runs on the Web Audio API with a custom engine and no audio
dependencies. Nothing is uploaded; projects persist locally in your browser.

## Stack

- Vite + vanilla TypeScript (no UI framework)
- Raw Web Audio API — custom voice/transport engine
- Cloudflare Workers Static Assets (two workers from one build: the studio and the synth)

## Develop

```
npm install
npm run dev      # local dev server
npm test         # vitest (engine, schema, serialization, sequencer timing, WAV encoder)
npm run build    # type-check + production build to dist/
```

In-browser verification harnesses (e.g. `window.__tracksEqTest`,
`window.__tracksTempoTest`) render the real engine through an
`OfflineAudioContext` and return measurable stats.

## Deploy

Push to `main` — GitHub Actions builds and runs `wrangler deploy` for both
workers (repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). The
custom domains are bound in Cloudflare and persist across deploys.

## License

Copyright © JFound.

Tracks is free software, licensed under the **GNU Affero General Public License
v3.0 or later** (AGPL-3.0-or-later). You may use, study, share, and modify it
under those terms. Because the AGPL covers network use, if you run a modified
version of Tracks as a network service, you must make your modified source
available to its users. See [`LICENSE`](LICENSE) for the full text.
