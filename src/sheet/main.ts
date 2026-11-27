// The sheet music editor (/sheet-music): a YuE2 score as sheet music and as
// ABC text side by side. Clicking a note picks it in both; the note buttons
// and keys change the text through yue-abc.ts so the score keeps YuE2's shape;
// typing re-checks and redraws as you go. Nothing leaves the browser.
import { track } from '../daw/analytics'
import type { DrawnSheet } from '../daw/sheet-render'
import { isPhone } from '../mobile-gate'
import { fromFile, toFile } from './file'
import { sendScore, takeScore } from './handoff'
import { check, edit, locate, newScore, noteName, unitsOf, type Op, type Score, type Target, type VoiceName } from './yue-abc'

const STORE = 'tracks.sheet.v1'
const EDITED = 'tracks.sheet.edited'
const EXAMPLE = `X:1
T:
M:4/4
L:1/16
Q:1/4=96
V: Vocal clef=treble name="Vocal Melody" snm="Vocal"
V: Ins clef=treble name="Ins Melody" snm="Inst."
K:C
% verse
V: Vocal
"C"E4G4c4G4|"Am"A4c4e4c4|"F"f4e4d4c4|"G"B4d4"C"c8|
V: Ins
Z4|
`
const MAJOR_ORDER = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']
const MINOR_ORDER = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm']
const LENGTH_NAMES: Record<number, string> = {
  32: 'thirty-second', 48: 'dotted thirty-second', 64: 'sixteenth', 96: 'dotted sixteenth', 128: 'eighth', 192: 'dotted eighth',
  256: 'quarter', 384: 'dotted quarter', 512: 'half', 768: 'dotted half', 1024: 'whole', 1536: 'dotted whole', 2048: 'double whole', 3072: 'dotted double whole',
}

declare global {
  interface Window { __tracksSheet?: { state: string; peak: number; seconds: number; renders: number } }
}

const $ = <T extends Element>(sel: string): T => document.querySelector<T>(sel)!
const view = $<HTMLElement>('.se-view')
const ta = $<HTMLTextAreaElement>('#se-text')
const mirror = $<HTMLElement>('.se-mirror')
const picked = $<HTMLElement>('.se-picked')
const verdict = $<HTMLElement>('.se-verdict')
const problemList = $<HTMLElement>('.se-problems')
const nameEl = $<HTMLElement>('.se-name')
const fileInput = $<HTMLInputElement>('.se-files input[type=file]')
const playBtn = $<HTMLButtonElement>('[data-act=play]')
const studioBtn = $<HTMLButtonElement>('[data-act=studio]')
const chordInput = $<HTMLInputElement>('.se-chord input')
const lyrics = $<HTMLTextAreaElement>('.se-lyrics textarea')
const newDialog = $<HTMLDialogElement>('.se-new')
window.__tracksSheet = { state: 'stopped', peak: 0, seconds: 0, renders: 0 }

interface Snap { text: string; sel: Range | null }
interface Range { start: number; end: number }
let text = ''
let name = 'score.abc'
let score: Score = check('')
let sel: Range | null = null
const undos: Snap[] = []
let redos: Snap[] = []
let typedAt = 0
let drawn: DrawnSheet | null = null
let draws = 0
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let storeTimer: ReturnType<typeof setTimeout> | undefined
let editTimer: ReturnType<typeof setTimeout> | undefined
let noteTimer: ReturnType<typeof setTimeout> | undefined

// ---- the score, its check, and the two views ----------------------------

/** Replace the whole score (a button edit, a new or opened score), keeping the old one in Undo. */
function commit(next: string, nextSel: Range | null, kind: 'edit' | 'load'): void {
  if (next !== text) { undos.push({ text, sel }); redos = [] }
  typedAt = 0
  text = next
  sel = nextSel
  if (ta.value !== text) ta.value = text
  if (kind === 'edit') edited()
  refresh(true)
}

function refresh(scrollText = false): void {
  clearTimeout(refreshTimer)
  stopPlaying()
  score = check(text)
  if (sel && (sel.end > text.length || !locate(score, sel.start, sel.end))) sel = null
  if (document.activeElement === ta) followCaret()
  showCheck()
  showMirror()
  if (scrollText) revealInText()
  showPicked()
  void draw()
  remember()
}

async function draw(): Promise<void> {
  const mine = ++draws
  const { drawSheet } = await import('../daw/sheet-render')
  if (mine !== draws) return
  drawn?.destroy()
  drawn = null
  try {
    narrow = narrowView()
    drawn = drawSheet(view, text, score.bpm || 120, playBeat, { onClick: pickAt, selectionColor: '#ff4d00', ...(narrow ? { wrapWidth: narrow } : {}) })
    if (sel) drawn.select(sel.start, sel.end)
    window.__tracksSheet!.renders++
  } catch {
    view.innerHTML = '<p class="se-view-empty">Nothing to draw yet. Fix the text, or start a new score.</p>'
  }
}

/** on a phone-width view, the width to lay the score out at (two bars to a line); 0 when there's room */
function narrowView(): number {
  const w = view.clientWidth
  return w && w < 560 ? Math.round(w - 24) : 0
}
let narrow = 0
let resizeTimer: ReturnType<typeof setTimeout> | undefined
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => { if (Boolean(narrowView()) !== Boolean(narrow)) void draw() }, 250)
})

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

/** the text again, under the textarea: the picked note in orange, problems underlined */
function showMirror(): void {
  if (score.text !== text) { mirror.innerHTML = escapeHtml(text) + '\n '; return }
  const bad = score.problems.filter(p => p.end > p.start)
  const cuts = new Set([0, text.length])
  if (sel) { cuts.add(sel.start); cuts.add(sel.end) }
  for (const p of bad) { cuts.add(Math.min(p.start, text.length)); cuts.add(Math.min(p.end, text.length)) }
  const points = [...cuts].sort((a, b) => a - b)
  let html = ''
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k], b = points[k + 1]
    let part = escapeHtml(text.slice(a, b))
    if (sel && a >= sel.start && b <= sel.end) part = `<mark>${part}</mark>`
    if (bad.some(p => a >= p.start && b <= p.end)) part = `<span class="se-bad">${part}</span>`
    html += part
  }
  mirror.innerHTML = html + '\n '
  syncScroll()
}
function syncScroll(): void { mirror.scrollTop = ta.scrollTop; mirror.scrollLeft = ta.scrollLeft }

/** scroll the text so the picked note shows */
function revealInText(): void {
  const mark = mirror.querySelector<HTMLElement>('mark')
  if (!mark) return
  const pad = 24
  if (mark.offsetTop < ta.scrollTop + pad || mark.offsetTop > ta.scrollTop + ta.clientHeight - pad * 2) ta.scrollTop = Math.max(0, mark.offsetTop - ta.clientHeight / 3)
  if (mark.offsetLeft < ta.scrollLeft + pad || mark.offsetLeft > ta.scrollLeft + ta.clientWidth - pad * 3) ta.scrollLeft = Math.max(0, mark.offsetLeft - ta.clientWidth / 3)
  syncScroll()
}

function showCheck(): void {
  const n = score.problems.length
  const bars = score.bars.Vocal.length
  const notes = score.notes.Vocal.length + score.notes.Ins.length
  verdict.className = 'se-verdict ' + (n ? 'se-warn' : 'se-ok')
  verdict.textContent = n
    ? `${n === 1 ? '1 problem' : `${n} problems`}. YuE2 won't take this score until ${n === 1 ? "it's" : "they're"} fixed. You can still save it.`
    : `YuE2 can read this score: ${bars} ${bars === 1 ? 'bar' : 'bars'}, ${notes} ${notes === 1 ? 'note' : 'notes'}, ${score.chords.length} chord ${score.chords.length === 1 ? 'symbol' : 'symbols'}.`
  problemList.textContent = ''
  for (const p of score.problems.slice(0, 50)) {
    const li = document.createElement('li')
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = p.message
    b.addEventListener('click', () => { ta.focus(); ta.setSelectionRange(p.start, p.end); sel = { start: p.start, end: p.end }; showMirror(); revealInText() })
    li.append(b)
    problemList.append(li)
  }
  const key = score.key.endsWith('m') ? `${score.key.slice(0, -1)} minor` : `${score.key} major`
  nameEl.textContent = score.bpm ? `${name} · ${key} · ${score.meter[0]}/${score.meter[1]} · ${score.bpm} BPM` : name
}

function lengthName(ticks: number, rest: boolean): string {
  const base = LENGTH_NAMES[ticks]
  return base ? `${base} ${rest ? 'rest' : 'note'}` : `${rest ? 'rest' : 'note'} of ${ticks / 256} beats`
}

function target(): Target | null {
  return sel && score.text === text ? locate(score, sel.start, sel.end) : null
}

function showPicked(): void {
  const t = target()
  picked.classList.remove('se-refused')
  if (!t) { picked.textContent = 'Click a note in the sheet music to pick it.'; chordInput.value = ''; return }
  const bar = score.bars[t.voice][t.bar]
  const where = `${t.voice} part · bar ${t.bar + 1}`
  if (!t.tok) { picked.textContent = `${where} · rest for the whole bar`; chordInput.value = ''; return }
  const tok = t.tok
  const ticks = (tok.units! * 1024) / score.unit
  const chord = bar.toks.find(k => k.kind === 'chord' && k.onset === tok.onset)?.value ?? ''
  chordInput.value = chord
  picked.textContent = [where, tok.kind === 'note' ? noteName(tok) : null, lengthName(ticks, tok.kind === 'rest'), tok.tie ? 'tied to the next note' : null, chord ? `chord ${chord}` : null].filter(Boolean).join(' · ')
}

function say(message: string): void {
  picked.textContent = message
  picked.classList.add('se-refused')
  clearTimeout(noteTimer)
  noteTimer = setTimeout(showPicked, 6000)
}

function tell(message: string): void {
  picked.textContent = message
  picked.classList.remove('se-refused')
  clearTimeout(noteTimer)
  noteTimer = setTimeout(showPicked, 6000)
}

// ---- picking ---------------------------------------------------------------

/** a click on the sheet music: pick that note in both views */
function pickAt(start: number, end: number): void {
  if (score.text !== text) refresh()
  const t = locate(score, start, end)
  if (!t) return
  select({ start: t.start, end: t.end })
}

function select(range: Range): void {
  sel = range
  drawn?.select(range.start, range.end)
  showMirror()
  revealInText()
  showPicked()
}

/** the caret moved in the text: pick the note it is on */
function followCaret(): void {
  if (score.text !== text) return
  const t = locate(score, ta.selectionStart, ta.selectionEnd)
  if (!t) return
  sel = { start: t.start, end: t.end }
  drawn?.select(t.start, t.end)
  showMirror()
  showPicked()
}

/** the notes and rests of the picked note's part, in order */
function neighbour(dir: 1 | -1): void {
  const t = target()
  const voice: VoiceName = t?.voice ?? 'Vocal'
  const spots: Range[] = score.bars[voice].flatMap(b => (b.z ? [{ start: b.start, end: b.end }] : b.toks.filter(k => k.kind === 'note' || k.kind === 'rest').map(k => ({ start: k.start, end: k.end }))))
  if (!spots.length) return
  const at = t ? spots.findIndex(s => s.start === t.start) : -1
  const next = at < 0 ? (dir > 0 ? 0 : spots.length - 1) : Math.min(spots.length - 1, Math.max(0, at + dir))
  select(spots[next])
}

// ---- edits -------------------------------------------------------------------

function run(op: Op): void {
  if (score.text !== text) refresh()
  if (!sel && op.kind !== 'bar') { say('Pick a note first: click one in the sheet music.'); return }
  const result = edit(text, sel ? sel.start : text.length, op)
  if ('error' in result) { say(result.error); return }
  commit(result.text, { start: result.start, end: result.end }, 'edit')
}

function length(noteValue: number): void {
  const units = unitsOf(score, noteValue)
  if (!units) { say(`This score counts in 1/${score.unit} notes (its L: line), so it can't write that length.`); return }
  run({ kind: 'length', units })
}

function undo(): void {
  const snap = undos.pop()
  if (!snap) return
  redos.push({ text, sel })
  restore(snap)
}
function redo(): void {
  const snap = redos.pop()
  if (!snap) return
  undos.push({ text, sel })
  restore(snap)
}
function restore(snap: Snap): void {
  typedAt = 0
  text = snap.text
  sel = snap.sel
  ta.value = text
  refresh(true)
}

/** count the first edit of a visit, once things settle */
function edited(): void {
  try { if (sessionStorage.getItem(EDITED)) return } catch { /* counted below anyway */ }
  clearTimeout(editTimer)
  editTimer = setTimeout(() => {
    try { sessionStorage.setItem(EDITED, '1') } catch { /* private mode */ }
    track('sheet_edit')
  }, 3000)
}

function store(): void {
  clearTimeout(storeTimer)
  try { localStorage.setItem(STORE, JSON.stringify({ text, name, lyrics: lyrics.value })) } catch { /* storage full or blocked */ }
}
function remember(): void {
  clearTimeout(storeTimer)
  storeTimer = setTimeout(store, 400)
}
window.addEventListener('pagehide', store)

// ---- typing in the text ----------------------------------------------------

ta.addEventListener('input', () => {
  const now = Date.now()
  if (now - typedAt > 800) { undos.push({ text, sel }); redos = [] }
  typedAt = now
  text = ta.value
  showMirror()
  edited()
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => refresh(), 300)
})
ta.addEventListener('beforeinput', e => {
  if (e.inputType === 'historyUndo') { e.preventDefault(); undo() } else if (e.inputType === 'historyRedo') { e.preventDefault(); redo() }
})
ta.addEventListener('scroll', syncScroll)
document.addEventListener('selectionchange', () => { if (document.activeElement === ta) followCaret() })
lyrics.addEventListener('input', remember)

// ---- buttons and keys --------------------------------------------------------

const OPS: Record<string, Op | (() => void)> = {
  prev: () => neighbour(-1), next: () => neighbour(1),
  'step-up': { kind: 'step', dir: 1 }, 'step-down': { kind: 'step', dir: -1 },
  sharp: { kind: 'semitone', dir: 1 }, flat: { kind: 'semitone', dir: -1 },
  'oct-up': { kind: 'octave', dir: 1 }, 'oct-down': { kind: 'octave', dir: -1 },
  dot: { kind: 'dot' }, rest: { kind: 'rest' }, delete: { kind: 'delete' }, insert: { kind: 'insert' }, bar: { kind: 'bar' },
  chord: () => run({ kind: 'chord', symbol: chordInput.value }),
  undo, redo,
}
function doOp(which: string): void {
  const op = OPS[which]
  if (typeof op === 'function') op(); else if (op) run(op)
}
$('.se-tools').addEventListener('click', e => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button')
  if (!b) return
  if (b.dataset.len) length(Number(b.dataset.len))
  else if (b.dataset.op) doOp(b.dataset.op)
})
chordInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doOp('chord') } })

document.addEventListener('keydown', e => {
  if (newDialog.open) return
  const el = e.target as HTMLElement
  const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable
  const mod = e.ctrlKey || e.metaKey
  if (mod && /^[zy]$/i.test(e.key)) {
    if (field && el !== ta) return // the lyrics and chord boxes keep their own undo
    e.preventDefault()
    if (e.key.toLowerCase() === 'y' || e.shiftKey) redo(); else undo()
    return
  }
  if (field || mod) return
  const up = e.key === 'ArrowUp'
  let which: string | null = null
  if (e.key === 'ArrowLeft') which = 'prev'
  else if (e.key === 'ArrowRight') which = 'next'
  else if (up || e.key === 'ArrowDown') {
    if (e.shiftKey) which = up ? 'oct-up' : 'oct-down'
    else if (e.altKey) which = up ? 'sharp' : 'flat'
    else which = up ? 'step-up' : 'step-down'
  } else if (e.key === '.') which = 'dot'
  else if (/^r$/i.test(e.key)) which = 'rest'
  else if (e.key === 'Delete' || e.key === 'Backspace') which = 'delete'
  else if (/^i$/i.test(e.key) || e.key === 'Insert') which = 'insert'
  else if (e.key === '|') which = 'bar'
  else if (/^[1-5]$/.test(e.key)) { e.preventDefault(); length([16, 8, 4, 2, 1][Number(e.key) - 1]); return }
  else if (/^c$/i.test(e.key)) { e.preventDefault(); chordInput.focus(); chordInput.select(); return }
  if (!which) return
  e.preventDefault()
  doOp(which)
})

// ---- files -------------------------------------------------------------------

function download(bytes: BlobPart, file: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = file
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
const base = (): string => name.replace(/\.abc$/i, '') || 'score'

async function open(file: File): Promise<void> {
  let opened: string
  try {
    opened = fromFile(new Uint8Array(await file.arrayBuffer()))
  } catch {
    say(`${file.name} isn't a text file, so it can't be a score.`)
    return
  }
  const had = text
  name = /\.abc$/i.test(file.name) ? file.name : `${file.name}.abc`
  commit(opened, null, 'load')
  const n = score.problems.length
  tell(`Opened ${file.name}${n ? `: it has ${n === 1 ? '1 problem' : `${n} problems`} for YuE2, listed under Score check` : ''}.${had ? ' Undo brings back the score you had.' : ''}`)
}

const act: Record<string, () => void> = {
  new: () => {
    const keys = newDialog.querySelector<HTMLSelectElement>('select[name=key]')!
    if (!keys.options.length) {
      for (const [label, list] of [['Major', MAJOR_ORDER], ['Minor', MINOR_ORDER]] as const) {
        const group = document.createElement('optgroup')
        group.label = label
        for (const k of list) group.append(new Option(k.endsWith('m') ? `${k.slice(0, -1)} minor` : `${k} major`, k))
        keys.append(group)
      }
    }
    newDialog.returnValue = ''
    newDialog.showModal()
  },
  open: () => fileInput.click(),
  save: () => {
    download(toFile(text) as BlobPart, name, 'text/vnd.abc')
    const n = score.text === text ? score.problems.length : check(text).problems.length
    if (n) say(`Saved ${name}, with ${n === 1 ? '1 problem' : `${n} problems`} left: YuE2 won't take it until ${n === 1 ? "it's" : "they're"} fixed.`)
    else tell(`Saved ${name}.`)
    track('sheet_save', { problems: n, bars: score.bars.Vocal.length })
  },
  print: () => window.print(),
  play: () => { void play() },
  studio: () => {
    if (!sendScore('studio', { text, name })) { say("This browser wouldn't hand the score over. Save it, then open it in the studio."); return }
    location.assign('/studio?from=sheet-music')
  },
  lyrics: () => {
    download(lyrics.value, `${base()}-lyrics.txt`, 'text/plain')
    tell(`Saved ${base()}-lyrics.txt.`)
  },
}
$('.se-files').addEventListener('click', e => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-act]')
  if (b) act[b.dataset.act!]?.()
})
$('[data-act=lyrics]').addEventListener('click', () => act.lyrics())
fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) void open(f); fileInput.value = '' })
newDialog.addEventListener('close', () => {
  if (newDialog.returnValue !== 'create') return
  const form = newDialog.querySelector('form')!
  const data = new FormData(form)
  const [n, d] = String(data.get('meter')).split('/').map(Number)
  const bpm = Math.min(240, Math.max(40, Number(data.get('bpm')) || 96))
  const bars = Math.min(64, Math.max(1, Math.round(Number(data.get('bars')) || 8)))
  name = 'score.abc'
  commit(newScore({ bpm, meter: [n, d], key: String(data.get('key')), bars }), null, 'load')
  tell('New score. Undo brings back the score you had.')
})
const main = $<HTMLElement>('main.se')
window.addEventListener('dragover', e => { if ([...(e.dataTransfer?.items ?? [])].some(i => i.kind === 'file')) { e.preventDefault(); main.classList.add('se-drop-hint') } })
window.addEventListener('dragleave', e => { if (!e.relatedTarget) main.classList.remove('se-drop-hint') })
window.addEventListener('drop', e => {
  main.classList.remove('se-drop-hint')
  const f = e.dataTransfer?.files[0]
  if (!f) return
  e.preventDefault()
  void open(f)
})

// ---- playing -------------------------------------------------------------------

let context: AudioContext | null = null
let source: AudioBufferSourceNode | null = null
let startedAt = 0
let playingBpm = 120
let prepared: { text: string; buffer: AudioBuffer; bpm: number } | null = null
let preparing = 0

function playBeat(): number {
  return source && context ? ((context.currentTime - startedAt - 0.05) * playingBpm) / 60 : -1
}

function stopPlaying(): void {
  preparing++
  if (source) { source.onended = null; try { source.stop() } catch { /* already stopped */ } }
  source = null
  playBtn.textContent = 'Play'
  playBtn.setAttribute('aria-pressed', 'false')
  playBtn.disabled = false
  window.__tracksSheet!.state = 'stopped'
}

async function play(): Promise<void> {
  if (source) { stopPlaying(); return }
  context ??= new AudioContext() // made inside the click, so the browser lets it sound
  void context.resume()
  const mine = ++preparing
  const wanted = text
  try {
    if (!prepared || prepared.text !== wanted) {
      playBtn.disabled = true
      playBtn.textContent = 'Preparing…'
      const [{ parseAbc, abcToProject }, { renderProject }] = await Promise.all([import('../daw/abc'), import('../daw/render')])
      const parsed = parseAbc(wanted)
      if (parsed.error) throw new Error(parsed.error)
      const project = abcToProject(parsed, name)
      if (!project.tracks.some(t => t.clips.some(c => c.notes.length))) throw new Error('There are no notes to play yet.')
      const buffer = await renderProject(project)
      let peak = 0
      for (let c = 0; c < buffer.numberOfChannels; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])) }
      prepared = { text: wanted, buffer, bpm: project.bpm }
      Object.assign(window.__tracksSheet!, { peak, seconds: buffer.duration })
    }
    if (mine !== preparing) return
    source = context.createBufferSource()
    source.buffer = prepared.buffer
    source.connect(context.destination)
    source.onended = stopPlaying
    playingBpm = prepared.bpm
    startedAt = context.currentTime
    source.start()
    playBtn.disabled = false
    playBtn.textContent = 'Stop'
    playBtn.setAttribute('aria-pressed', 'true')
    window.__tracksSheet!.state = 'playing'
  } catch (err) {
    if (mine !== preparing) return
    stopPlaying()
    say(err instanceof Error && err.message ? err.message : "Couldn't play this score.")
  }
}

// ---- start -------------------------------------------------------------------------

function start(): void {
  let saved: { text?: unknown; name?: unknown; lyrics?: unknown } | null = null
  try { saved = JSON.parse(localStorage.getItem(STORE) || 'null') } catch { saved = null }
  text = typeof saved?.text === 'string' ? saved.text : EXAMPLE
  if (typeof saved?.name === 'string') name = saved.name
  if (typeof saved?.lyrics === 'string') lyrics.value = saved.lyrics
  ta.value = text
  let from = saved ? 'saved' : 'new'
  const url = new URL(location.href)
  const incoming = takeScore('sheet-music')
  if (url.searchParams.has('from')) {
    url.searchParams.delete('from')
    history.replaceState(null, '', url.pathname + url.search + url.hash)
  }
  if (incoming) {
    from = 'studio'
    const had = saved !== null
    name = incoming.name
    commit(incoming.text, null, 'load')
    tell(`Opened ${incoming.name.replace(/\.abc$/i, '')} from the studio.${had ? ' Undo brings back the score you had here.' : ''}`)
  } else refresh()
  if (isPhone()) { studioBtn.hidden = true; $<HTMLElement>('.se-phone-note').hidden = false }
  track('sheet_open', { from })
}
start()
