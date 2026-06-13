// App settings — everything lives in THIS browser's localStorage. Tracks is
// a local tool: no accounts, no cloud, nothing leaves the device.

export interface AppSettings {
  outputVolume: number // 0..1, live monitoring level (does not affect exports)
  clickVolume: number // 0..1, metronome level
  countInBars: 0 | 1 | 2 // bars of clicks before recording starts
  arrangeSnap: number // beats; clip drag/resize + ruler snap
  autosave: boolean // keep the session in this browser
  micProcessing: boolean // echo cancellation/noise suppression (voice) vs raw (music)
  mp3Kbps: 128 | 192 | 320
  exportRate: 44100 | 48000 // WAV/MP3/stems sample rate
  midiInput: string | null // active hardware MIDI device name; null = all
}

const KEY = 'tracks.settings.v1'

export function defaultSettings(): AppSettings {
  return {
    outputVolume: 0.9,
    clickVolume: 0.4,
    countInBars: 1,
    arrangeSnap: 1,
    autosave: true,
    micProcessing: false,
    mp3Kbps: 192,
    exportRate: 44100,
    midiInput: null,
  }
}

function load(): AppSettings {
  const out = defaultSettings()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return out
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    if (typeof parsed.outputVolume === 'number') out.outputVolume = clamp01(parsed.outputVolume)
    if (typeof parsed.clickVolume === 'number') out.clickVolume = clamp01(parsed.clickVolume)
    if (parsed.countInBars === 0 || parsed.countInBars === 1 || parsed.countInBars === 2) out.countInBars = parsed.countInBars
    if ([0.25, 0.5, 1, 2, 4].includes(parsed.arrangeSnap as number)) out.arrangeSnap = parsed.arrangeSnap as number
    if (typeof parsed.autosave === 'boolean') out.autosave = parsed.autosave
    if (typeof parsed.micProcessing === 'boolean') out.micProcessing = parsed.micProcessing
    if (parsed.mp3Kbps === 128 || parsed.mp3Kbps === 192 || parsed.mp3Kbps === 320) out.mp3Kbps = parsed.mp3Kbps
    if (parsed.exportRate === 44100 || parsed.exportRate === 48000) out.exportRate = parsed.exportRate
    if (typeof parsed.midiInput === 'string' || parsed.midiInput === null) out.midiInput = parsed.midiInput ?? null
  } catch {
    // corrupted settings → defaults
  }
  return out
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

// One mutable instance shared by the whole app; call saveSettings() after edits.
export const settings: AppSettings = load()

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // private mode etc. — settings just won't stick
  }
}
