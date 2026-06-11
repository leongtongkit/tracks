# Synth

Browser synthesizer at [synth.jfound.net](https://synth.jfound.net). Play with your computer keyboard, design sounds with a full subtractive + FM engine, add effects, sequence loops, record to WAV, and share patches by link.

## Features

- **Two-manual computer keyboard**: Z-row + S-row = lower keyboard, Q-row + number row = upper (one octave up). Arrow keys shift octave, Tab bends pitch up, Left Shift bends down, Escape stops all notes.
- **Engine**: 3 oscillators (saw/square/sine/triangle/noise, octave/semi/fine), FM (ratio + depth), LP/HP/BP filter with resonance, envelope amount and key tracking, dual ADSR, 2 LFOs routable to pitch/filter/amp, poly (10 voices with stealing) / mono / legato with glide.
- **FX rack**: drive, bitcrusher (AudioWorklet), chorus, phaser, delay, reverb (generated impulse), master limiter. True bypass: an effect that is off costs nothing.
- **35 factory presets** across bass/lead/pad/pluck/keys/bell/brass/wobble/fx, plus user patches saved to the browser.
- **Share by link**: the entire patch is compressed into the URL fragment.
- **16-step sequencer**: lookahead-scheduled (drift-free), per-step pitch via vertical drag, pattern persists.
- **Recording**: capture everything you play to a 16-bit WAV download.
- **Web MIDI**: plug in a keyboard (Chrome/Edge), velocity + pitch bend supported.

## Stack

- Vite + vanilla TypeScript (no UI framework)
- Raw Web Audio API — custom voice engine, zero audio dependencies
- Cloudflare Worker with static assets

## Develop

```
npm install
npm run dev      # local dev server
npm test         # vitest (allocator, schema, serialization, sequencer timing, WAV encoder)
npm run build    # type-check + production build to dist/
```

The in-browser verification harness (`window.__synthRenderTest`, `window.__synthPresetSweep`) renders the real engine through an OfflineAudioContext and returns measurable stats; CI-friendly via Playwright.

## Deploy

Push to `main` — GitHub Actions builds and runs `wrangler deploy` (secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). The custom domain `synth.jfound.net` is bound to the `synth-jfound` Worker in Cloudflare and persists across deploys.
