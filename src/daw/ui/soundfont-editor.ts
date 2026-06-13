// SoundFont editor: load a .sf2 file and pick one of its presets. The parsed
// font lands in the runtime SoundFontStore (raw bytes persisted to IndexedDB);
// the project only references it by id. .sf2 binaries stay local to this
// browser — they are not embedded in project exports.

import type { DawApp } from '../daw-app'
import { newId } from '../project'
import { soundFontStore } from '../soundfont-store'

export function buildSoundFontEditor(app: DawApp, trackId: string): HTMLElement {
  const track = app.track(trackId)
  const root = document.createElement('div')
  root.className = 'sampler-editor'
  if (!track) return root
  const sf = track.soundfont

  const info = document.createElement('div')
  info.className = 'sampler-info'
  root.appendChild(info)

  const row = document.createElement('div')
  row.className = 'sampler-row'
  root.appendChild(row)

  const load = document.createElement('button')
  load.type = 'button'
  load.className = 'seg-btn'
  load.textContent = 'Load .sf2'
  load.title = 'Load a SoundFont (.sf2) — multisampled instruments (pianos, strings, drums…)'
  const file = document.createElement('input')
  file.type = 'file'
  file.accept = '.sf2,audio/x-soundfont'
  file.style.display = 'none'
  load.addEventListener('click', () => file.click())
  row.appendChild(load)

  const presetSel = document.createElement('select')
  presetSel.className = 'seg-select'
  presetSel.title = 'Choose which instrument (preset) of this SoundFont to play'
  presetSel.addEventListener('change', () => app.setSoundFont(trackId, { presetIndex: Number(presetSel.value) }))
  row.appendChild(presetSel)
  row.appendChild(file)

  const hint = document.createElement('p')
  hint.className = 'audio-hint'
  hint.textContent = 'SoundFonts stay on this device (stored in your browser, never uploaded). General-MIDI .sf2 banks work great.'
  root.appendChild(hint)

  const renderPresets = (): void => {
    presetSel.innerHTML = ''
    const font = sf.id ? soundFontStore.get(sf.id) : undefined
    if (!font) {
      presetSel.style.display = 'none'
      return
    }
    presetSel.style.display = ''
    font.presets.forEach((p, i) => {
      const o = document.createElement('option')
      o.value = String(i)
      o.textContent = `${p.bank ? `${p.bank}:` : ''}${p.program} ${p.name}`
      if (i === sf.presetIndex) o.selected = true
      presetSel.appendChild(o)
    })
  }

  const renderInfo = (): void => {
    if (sf.id && soundFontStore.has(sf.id)) {
      const font = soundFontStore.get(sf.id)
      info.textContent = `${sf.name} — ${font?.presets.length ?? 0} presets, ${font?.samples.length ?? 0} samples`
    } else if (sf.id) {
      info.textContent = `${sf.name || 'SoundFont'} — not loaded on this device. Re-load the .sf2 to play it.`
    } else {
      info.textContent = 'No SoundFont loaded. Load a .sf2 bank and play its instruments across the keyboard.'
    }
  }

  file.addEventListener('change', async () => {
    const f = file.files?.[0]
    if (!f) return
    info.textContent = `Loading ${f.name}…`
    try {
      const bytes = await f.arrayBuffer()
      const id = newId()
      const font = soundFontStore.put(id, f.name, bytes)
      app.setSoundFont(trackId, { id, name: f.name, presetIndex: 0 })
      info.textContent = `${f.name} — ${font.presets.length} presets, ${font.samples.length} samples`
      renderPresets()
    } catch (e) {
      info.textContent = `Could not read ${f.name} as a SoundFont (${e instanceof Error ? e.message : 'parse error'}).`
    }
    file.value = ''
  })

  renderInfo()
  renderPresets()
  return root
}
