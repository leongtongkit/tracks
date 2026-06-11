# Synth

Browser synthesizer at [synth.jfound.net](https://synth.jfound.net). Play with your computer keyboard, design sounds with a full subtractive + FM engine, add effects, sequence loops, record to WAV, and share patches by link.

## Stack

- Vite + vanilla TypeScript (no UI framework)
- Raw Web Audio API — custom voice engine, no audio libraries
- Cloudflare Worker with static assets

## Develop

```
npm install
npm run dev      # local dev server
npm test         # vitest
npm run build    # type-check + production build to dist/
```

## Deploy

Push to `main` — GitHub Actions builds and runs `wrangler deploy` (secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). The custom domain `synth.jfound.net` is bound to the `synth-jfound` Worker in Cloudflare and persists across deploys.
