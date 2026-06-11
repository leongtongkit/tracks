// Phase 1: audio unlock flow + beep through the master gain path.
// The real engine replaces playBeep in Phase 2; the unlock pattern stays.

let ctx: AudioContext | null = null
let masterGain: GainNode | null = null

function ensureAudio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' })
    masterGain = ctx.createGain()
    masterGain.gain.value = 0.8
    masterGain.connect(ctx.destination)
  }
  if (ctx.state !== 'running') void ctx.resume()
  return ctx
}

function playBeep() {
  const ac = ensureAudio()
  const osc = ac.createOscillator()
  const env = ac.createGain()
  const now = ac.currentTime
  osc.frequency.value = 440
  env.gain.setValueAtTime(0, now)
  env.gain.linearRampToValueAtTime(0.5, now + 0.01)
  env.gain.setTargetAtTime(0, now + 0.2, 0.05)
  osc.connect(env)
  env.connect(masterGain!)
  osc.start(now)
  osc.stop(now + 0.6)
  osc.onended = () => {
    osc.disconnect()
    env.disconnect()
  }
}

function unlock() {
  document.getElementById('scrim')?.classList.add('hidden')
  playBeep()
  document.removeEventListener('pointerdown', unlock, true)
  document.removeEventListener('keydown', unlock, true)
}

document.addEventListener('pointerdown', unlock, true)
document.addEventListener('keydown', unlock, true)

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') {
    void ctx.resume()
  }
})
