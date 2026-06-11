import { initMidi, type MidiHandlers } from '../input/midi'
import { downloadBlob, Recorder } from '../record/recorder'
import { toast } from './toast'

export interface RecordMidiDeps {
  getAudio(): { ctx: AudioContext; tap: AudioNode } // engine context + master bus
  midi: MidiHandlers
}

// Rec (WAV capture of everything you play) + MIDI (connect a hardware keyboard).
export function buildRecordMidi(deps: RecordMidiDeps): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'rec-midi'
  const recorder = new Recorder()
  let timer: ReturnType<typeof setInterval> | null = null

  const recBtn = document.createElement('button')
  recBtn.type = 'button'
  recBtn.className = 'seg-btn rec-btn'
  recBtn.innerHTML = `<span class="rec-dot" aria-hidden="true"></span>Rec`
  recBtn.setAttribute('aria-label', 'Record what you play to a WAV file')

  recBtn.addEventListener('click', () => {
    void (async () => {
      const { ctx, tap } = deps.getAudio()
      if (!recorder.recording) {
        try {
          await recorder.start(ctx, tap)
        } catch {
          toast('Recording is not available in this browser.')
          return
        }
        recBtn.classList.add('rec-live')
        timer = setInterval(() => {
          const s = Math.floor(recorder.elapsed(ctx))
          recBtn.innerHTML = `<span class="rec-dot" aria-hidden="true"></span>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
        }, 500)
        toast('Recording. Play something, then press the red button to download.')
      } else {
        if (timer !== null) clearInterval(timer)
        timer = null
        const blob = recorder.stop(ctx)
        recBtn.classList.remove('rec-live')
        recBtn.innerHTML = `<span class="rec-dot" aria-hidden="true"></span>Rec`
        if (blob) {
          downloadBlob(blob, 'synth-recording.wav')
          toast('Saved your recording as a WAV file.')
        } else {
          toast('Nothing was recorded.')
        }
      }
    })()
  })

  const midiBtn = document.createElement('button')
  midiBtn.type = 'button'
  midiBtn.className = 'seg-btn'
  midiBtn.textContent = 'MIDI'
  midiBtn.setAttribute('aria-label', 'Connect a MIDI keyboard')
  midiBtn.addEventListener('click', () => {
    void (async () => {
      deps.getAudio() // make sure audio is unlocked before notes arrive
      const result = await initMidi(deps.midi)
      if (result.status === 'ok') {
        midiBtn.classList.add('seg-on')
        toast(`MIDI connected: ${result.inputs.join(', ')}`)
      } else if (result.status === 'no-inputs') {
        toast('MIDI is on. Plug in a keyboard and it will work.')
        midiBtn.classList.add('seg-on')
      } else if (result.status === 'unsupported') {
        toast('This browser has no MIDI support. Chrome and Edge do.')
      } else {
        toast('MIDI permission was declined.')
      }
    })()
  })

  wrap.appendChild(recBtn)
  wrap.appendChild(midiBtn)
  return wrap
}
