// The Sheet music dialog: shows a track as notation (with chord names from a
// second track), plays along with a cursor, prints, and imports or exports ABC
// for YuE2. Loaded on first open, so none of it weighs on the studio's first load.
import { exportAbc } from './abc'
import { track } from './analytics'
import type { DawApp } from './daw-app'
import { fileBase } from './library'
import { downloadBlob } from './persist'
import { defaultParts, keyName, notationAbc } from './sheet'
import type { DrawnSheet } from './sheet-render'

export interface SheetDialogContext {
  app: DawApp
  importSheet(file: File): void
  onClose(): void
}

export function openSheetDialog(ctx: SheetDialogContext): { close(): void; status: HTMLElement } {
  const { app } = ctx
  const overlay = document.createElement('div'); overlay.className = 'help-overlay sheet-overlay'
  const card = document.createElement('div'); card.className = 'help-card replace-card sheet-card'
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Sheet music')
  card.innerHTML = `<div class="sheet-head"><h2>Sheet music</h2><button class="seg-btn sheet-close" type="button">Close</button></div>
<div class="sheet-bar"><label>Melody from <select aria-label="Melody from"></select></label><label>Chords from <select aria-label="Chords from"><option value="">No chords</option></select></label><button class="seg-btn sheet-play" type="button">Play</button><button class="seg-btn sheet-print" type="button">Print / Save as PDF</button></div>
<p class="sheet-meta"></p><div class="sheet-score"></div><p class="sheet-note"></p>
<div class="sheet-io"><h3>Import</h3><button class="seg-btn sheet-choose" type="button">Choose .abc file</button><input type="file" accept=".abc,text/vnd.abc,text/plain" hidden><div class="sheet-drop">or drop an .abc file here</div><p>Notes, chords, tempo, time signature and key come in. Lyrics don't.</p><h3>Export</h3><p>Saves the melody and chords shown above as an .abc file.</p><button class="seg-btn sheet-download" type="button">Download .abc</button><p role="status"></p><a href="/blog/yue2-sheet-music-tracks" target="_blank" rel="noopener">How to use this with YuE2</a></div>`
  const $ = <T extends Element>(sel: string): T => card.querySelector<T>(sel)!
  const input = $<HTMLInputElement>('input'), melody = $<HTMLSelectElement>('[aria-label="Melody from"]'), chords = $<HTMLSelectElement>('[aria-label="Chords from"]')
  const score = $<HTMLElement>('.sheet-score'), meta = $<HTMLElement>('.sheet-meta'), note = $<HTMLElement>('.sheet-note')
  const play = $<HTMLButtonElement>('.sheet-play'), print = $<HTMLButtonElement>('.sheet-print'), download = $<HTMLButtonElement>('.sheet-download')
  const status = $<HTMLElement>('[role="status"]')

  let drawn: DrawnSheet | null = null
  let renders = 0
  let viewed = false
  let closed = false
  let frame = 0
  // Escape closes; Space still plays and stops. Other keys stay out of the
  // studio behind, so Backspace can't delete the clip you opened this for.
  const escape = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); else if (e.code !== 'Space') e.stopPropagation() }
  const close = (): void => {
    if (closed) return
    closed = true
    drawn?.destroy(); cancelAnimationFrame(frame)
    overlay.remove(); document.body.classList.remove('sheet-open')
    document.removeEventListener('keydown', escape)
    ctx.onClose()
  }
  document.addEventListener('keydown', escape)
  $('.sheet-close').addEventListener('click', close)
  $('.sheet-choose').addEventListener('click', () => input.click())
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) ctx.importSheet(f) })
  const drop = $('.sheet-drop')
  drop.addEventListener('dragover', e => { e.preventDefault() })
  drop.addEventListener('drop', e => { const f = (e as DragEvent).dataTransfer?.files[0]; if (f && /\.abc$/i.test(f.name)) { e.preventDefault(); ctx.importSheet(f) } })

  const p = app.project
  const tracks = p.tracks.filter(t => t.clips.some(c => c.notes.length))
  for (const t of tracks) { melody.add(new Option(t.name, t.id)); chords.add(new Option(t.name, t.id)) }
  const parts = defaultParts(p, app.selectedClip?.trackId)
  if (parts.melody) melody.value = parts.melody
  chords.value = parts.chords ?? ''
  download.disabled = print.disabled = play.disabled = !tracks.length

  // the Play button follows the transport, whoever started it
  const follow = (): void => { const label = app.transport.playing ? 'Stop' : 'Play'; if (play.textContent !== label) play.textContent = label; frame = requestAnimationFrame(follow) }
  follow()
  play.addEventListener('click', () => app.togglePlay())
  print.addEventListener('click', () => window.print())

  const show = async (): Promise<void> => {
    drawn?.destroy(); drawn = null
    const render = ++renders
    score.removeAttribute('role'); score.removeAttribute('aria-label')
    if (!tracks.length) { score.textContent = 'Add a track with notes to see it here as sheet music.'; meta.textContent = ''; return }
    const sheet = notationAbc(app.project, melody.value, chords.value)
    const name = melody.selectedOptions[0]?.text ?? ''
    meta.textContent = `${keyName(app.project.key)} · ${Math.round(app.project.bpm)} BPM · ${app.project.timeSig.num}/${app.project.timeSig.den} · ${name}${chords.value ? ` with chords from ${chords.selectedOptions[0]?.text}` : ''}`
    note.textContent = sheet.messages.join(' ')
    if (sheet.error) { score.textContent = sheet.error; return }
    score.textContent = 'Drawing the notes…'
    try {
      const { drawSheet } = await import('./sheet-render')
      if (closed || render !== renders) return // closed, or another track was picked meanwhile
      drawn = drawSheet(score, sheet.text, Math.round(app.project.bpm), () => app.transport.positionBeat())
      score.setAttribute('role', 'img'); score.setAttribute('aria-label', `Sheet music for ${name}`)
      if (!viewed) { viewed = true; track('sheet_view', { notes: sheet.notes, chords: sheet.chords, clef: sheet.clef }) }
    } catch {
      if (!closed && render === renders) score.textContent = 'Could not draw the sheet music. Check your connection and try again.'
    }
  }
  melody.addEventListener('change', () => { void show() })
  chords.addEventListener('change', () => { void show() })

  download.addEventListener('click', () => {
    const result = exportAbc(app.project, melody.value, chords.value)
    if (result.error) { status.textContent = result.error; return }
    const file = `${fileBase(app.project.name)}.abc`
    downloadBlob(new Blob([result.text], { type: 'text/vnd.abc' }), file)
    status.textContent = result.messages.join(' ') || `Saved ${file}.`
    track('abc_export', { notes: result.notes, chords: result.chords, top_note: result.notes_dropped ? 1 : 0 })
  })

  overlay.appendChild(card); document.body.appendChild(overlay); document.body.classList.add('sheet-open')
  void show()
  return { close, status }
}
