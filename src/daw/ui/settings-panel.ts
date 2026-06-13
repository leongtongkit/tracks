// Settings panel: every app-level preference in one place. All of it lives in
// this browser's localStorage — Tracks is a local tool, nothing is uploaded.

import type { DawApp } from '../daw-app'
import { midiInputs, setMidiInput } from '../midi-control'
import { saveSettings, settings, type AppSettings } from '../settings'
import { miniDial } from './mini-dial'

export function buildSettingsPanel(app: DawApp): { toggle(): void } {
  const overlay = document.createElement('div')
  overlay.className = 'help-overlay hidden'
  const card = document.createElement('div')
  card.className = 'help-card settings-card'
  card.addEventListener('click', e => e.stopPropagation())

  const title = document.createElement('h2')
  title.textContent = 'Settings'
  card.appendChild(title)

  const privacy = document.createElement('p')
  privacy.className = 'audio-hint'
  privacy.textContent =
    'Tracks is a local tool: projects, recordings, and these settings stay in this browser. Nothing is uploaded anywhere.'
  card.appendChild(privacy)

  const changed = (): void => {
    saveSettings()
    app.applyAudioSettings()
  }

  const section = (name: string): HTMLElement => {
    const tag = document.createElement('span')
    tag.className = 'mix-tag'
    tag.textContent = name
    const row = document.createElement('div')
    row.className = 'sampler-row settings-row'
    row.appendChild(tag)
    card.appendChild(row)
    return row
  }

  const select = <K extends keyof AppSettings>(
    row: HTMLElement,
    label: string,
    title2: string,
    key: K,
    options: [AppSettings[K], string][],
  ): void => {
    const wrap = document.createElement('span')
    wrap.className = 'mini-dial'
    wrap.title = title2
    const tag = document.createElement('span')
    tag.textContent = label
    const sel = document.createElement('select')
    sel.className = 'seg-select'
    for (const [value, text] of options) {
      const o = document.createElement('option')
      o.value = String(value)
      o.textContent = text
      if (settings[key] === value) o.selected = true
      sel.appendChild(o)
    }
    sel.addEventListener('change', () => {
      const picked = options.find(([v]) => String(v) === sel.value)
      if (picked) settings[key] = picked[0]
      changed()
    })
    wrap.appendChild(tag)
    wrap.appendChild(sel)
    row.appendChild(wrap)
  }

  // ---------- sound ----------
  const sound = section('Sound')
  sound.appendChild(
    miniDial({
      label: 'Output',
      get: () => settings.outputVolume,
      set: v => {
        settings.outputVolume = v
        changed()
      },
      min: 0,
      max: 1,
      reset: 0.9,
      fmt: v => `${Math.round(v * 100)}%`,
    }),
  )
  sound.appendChild(
    miniDial({
      label: 'Click',
      get: () => settings.clickVolume,
      set: v => {
        settings.clickVolume = v
        changed()
      },
      min: 0,
      max: 1,
      reset: 0.4,
      fmt: v => `${Math.round(v * 100)}%`,
    }),
  )

  // ---------- recording ----------
  const rec = section('Recording')
  select(rec, 'Count-in', 'Clicks before recording starts', 'countInBars', [
    [0, 'Off'],
    [1, '1 bar'],
    [2, '2 bars'],
  ])
  select(rec, 'Mic', 'Raw keeps the signal untouched (music); Voice enables echo/noise cleanup', 'micProcessing', [
    [false, 'Raw (music)'],
    [true, 'Voice cleanup'],
  ])

  // MIDI device picker — populated live from the connected hardware
  const midiWrap = document.createElement('span')
  midiWrap.className = 'mini-dial'
  midiWrap.title = 'Hardware MIDI keyboard that plays/records into the armed track'
  const midiLabel = document.createElement('span')
  midiLabel.textContent = 'MIDI in'
  const midiSel = document.createElement('select')
  midiSel.className = 'seg-select'
  const refreshMidi = (): void => {
    const devices = midiInputs()
    midiSel.innerHTML = ''
    const all = document.createElement('option')
    all.value = ''
    all.textContent = devices.length ? 'All devices' : 'None connected'
    midiSel.appendChild(all)
    for (const name of devices) {
      const o = document.createElement('option')
      o.value = name
      o.textContent = name
      if (settings.midiInput === name) o.selected = true
      midiSel.appendChild(o)
    }
  }
  midiSel.addEventListener('change', () => {
    settings.midiInput = midiSel.value || null
    setMidiInput(settings.midiInput)
    changed()
  })
  midiWrap.appendChild(midiLabel)
  midiWrap.appendChild(midiSel)
  rec.appendChild(midiWrap)

  // ---------- editing ----------
  const edit = section('Editing')
  select(edit, 'Clip snap', 'Grid for dragging/resizing clips and the loop ruler', 'arrangeSnap', [
    [0.25, '1/16'],
    [0.5, '1/8'],
    [1, '1/4 (beat)'],
    [2, '1/2 bar'],
    [4, '1 bar'],
  ])
  select(edit, 'Autosave', 'Keep your session in this browser between visits', 'autosave', [
    [true, 'On'],
    [false, 'Off'],
  ])

  // ---------- export ----------
  const exp = section('Export')
  select(exp, 'MP3', 'MP3 bitrate', 'mp3Kbps', [
    [128, '128 kbps'],
    [192, '192 kbps'],
    [320, '320 kbps'],
  ])
  select(exp, 'Rate', 'WAV/MP3/stem sample rate', 'exportRate', [
    [44100, '44.1 kHz'],
    [48000, '48 kHz'],
  ])

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'seg-btn settings-close'
  close.textContent = 'Done'
  close.addEventListener('click', () => overlay.classList.add('hidden'))
  card.appendChild(close)

  overlay.appendChild(card)
  overlay.addEventListener('click', () => overlay.classList.add('hidden'))
  document.body.appendChild(overlay)
  return {
    toggle: () => {
      const opening = overlay.classList.contains('hidden')
      if (opening) refreshMidi() // pick up devices connected since last open
      overlay.classList.toggle('hidden')
    },
  }
}
