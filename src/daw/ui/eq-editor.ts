// Parametric EQ editor: a frequency-response curve over a live spectrum, with
// draggable band handles (x = frequency, y = gain), wheel-to-Q, and a per-band
// control row beneath. Up to MAX_EQ_BANDS bands. All edits go through
// app.setMixer so they checkpoint for undo and re-apply to the live graph.

import type { DawApp } from '../daw-app'
import { eqResponseDb } from '../dsp/eq-response'
import { eqUsesGain, MAX_EQ_BANDS, type EqBand, type EqBandType } from '../project'

const FMIN = 20
const FMAX = 20000
const DBMAX = 18
const W = 720
const H = 260
const MARGIN = 14
const HALF = H / 2 - MARGIN

const fToX = (f: number): number => (Math.log(f / FMIN) / Math.log(FMAX / FMIN)) * W
const xToF = (x: number): number => FMIN * Math.pow(FMAX / FMIN, Math.max(0, Math.min(1, x / W)))
const dbToY = (db: number): number => H / 2 - (db / DBMAX) * HALF
const yToDb = (y: number): number => Math.max(-DBMAX, Math.min(DBMAX, ((H / 2 - y) / HALF) * DBMAX))

const TYPES: EqBandType[] = ['lowshelf', 'peaking', 'highshelf', 'lowpass', 'highpass']
const TYPE_LABEL: Record<EqBandType, string> = {
  lowshelf: 'Low shelf',
  peaking: 'Bell',
  highshelf: 'High shelf',
  lowpass: 'Low pass',
  highpass: 'High pass',
}

export function buildEqEditor(app: DawApp): { open(trackId: string): void } {
  const overlay = document.createElement('div')
  overlay.className = 'help-overlay hidden'
  const card = document.createElement('div')
  card.className = 'help-card eq-card'
  card.addEventListener('click', e => e.stopPropagation())

  const title = document.createElement('h2')
  title.textContent = 'Equalizer'
  card.appendChild(title)

  const canvas = document.createElement('canvas')
  canvas.className = 'eq-canvas'
  canvas.width = W
  canvas.height = H
  card.appendChild(canvas)

  const list = document.createElement('div')
  list.className = 'eq-list'
  card.appendChild(list)

  const hint = document.createElement('p')
  hint.className = 'audio-hint'
  hint.textContent = 'Drag a dot to move a band (left↔right = frequency, up↓ = gain). Scroll over a dot for Q. Click empty space to add a band.'
  card.appendChild(hint)

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'help-close'
  close.textContent = 'Done'
  close.addEventListener('click', () => hide())
  card.appendChild(close)

  overlay.appendChild(card)
  overlay.addEventListener('click', () => hide())
  document.body.appendChild(overlay)

  let trackId = ''
  let raf = 0
  let dragIndex = -1
  let specBuf: Float32Array<ArrayBuffer> | null = null

  const bands = (): EqBand[] => app.project.tracks.find(t => t.id === trackId)?.mixer.eq ?? []

  const commit = (next: EqBand[]): void => {
    app.setMixer(trackId, { eq: next })
  }
  // immutably patch one band
  const patchBand = (i: number, p: Partial<EqBand>): void => {
    commit(bands().map((b, j) => (j === i ? { ...b, ...p } : b)))
  }

  function renderList(): void {
    list.innerHTML = ''
    const bs = bands()
    bs.forEach((b, i) => {
      const row = document.createElement('div')
      row.className = 'eq-row' + (b.on ? '' : ' eq-off')

      const chip = document.createElement('span')
      chip.className = 'eq-chip'
      chip.style.background = bandColor(i)
      chip.textContent = String(i + 1)
      row.appendChild(chip)

      const type = document.createElement('select')
      type.className = 'seg-select'
      for (const t of TYPES) {
        const o = document.createElement('option')
        o.value = t
        o.textContent = TYPE_LABEL[t]
        if (b.type === t) o.selected = true
        type.appendChild(o)
      }
      type.addEventListener('change', () => patchBand(i, { type: type.value as EqBandType }))
      row.appendChild(type)

      row.appendChild(numField('Hz', Math.round(b.freq), 20, 20000, v => patchBand(i, { freq: v })))
      const gainField = numField('dB', round1(b.gain), -DBMAX, DBMAX, v => patchBand(i, { gain: v }))
      if (!eqUsesGain(b.type)) gainField.classList.add('eq-dim')
      row.appendChild(gainField)
      row.appendChild(numField('Q', round1(b.q), 0.1, 18, v => patchBand(i, { q: v })))

      const onBtn = document.createElement('button')
      onBtn.type = 'button'
      onBtn.className = 'seg-btn' + (b.on ? ' seg-on' : '')
      onBtn.textContent = b.on ? 'On' : 'Off'
      onBtn.title = 'Enable/bypass this band'
      onBtn.addEventListener('click', () => patchBand(i, { on: !b.on }))
      row.appendChild(onBtn)

      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'seg-btn eq-del'
      del.textContent = '×'
      del.title = 'Remove this band'
      del.disabled = bs.length <= 1
      del.addEventListener('click', () => {
        commit(bands().filter((_, j) => j !== i))
        renderList()
      })
      row.appendChild(del)

      list.appendChild(row)
    })

    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'seg-btn eq-add'
    add.textContent = '+ band'
    add.disabled = bs.length >= MAX_EQ_BANDS
    add.addEventListener('click', () => {
      commit([...bands(), { type: 'peaking', freq: 1000, gain: 0, q: 1, on: true }])
      renderList()
    })
    list.appendChild(add)
  }

  // --- canvas interaction ---
  const localPt = (e: MouseEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }
  const handleY = (b: EqBand): number => (eqUsesGain(b.type) ? dbToY(b.gain) : H / 2)
  const hitTest = (x: number, y: number): number => {
    const bs = bands()
    for (let i = 0; i < bs.length; i++) {
      if (!bs[i].on) continue
      if (Math.hypot(x - fToX(bs[i].freq), y - handleY(bs[i])) < 13) return i
    }
    return -1
  }

  canvas.addEventListener('pointerdown', e => {
    const { x, y } = localPt(e)
    const hit = hitTest(x, y)
    if (hit >= 0) {
      dragIndex = hit
      canvas.setPointerCapture(e.pointerId)
    } else if (bands().length < MAX_EQ_BANDS) {
      commit([...bands(), { type: 'peaking', freq: clampF(xToF(x)), gain: yToDb(y), q: 1, on: true }])
      renderList()
    }
  })
  canvas.addEventListener('pointermove', e => {
    if (dragIndex < 0) return
    const { x, y } = localPt(e)
    const b = bands()[dragIndex]
    if (!b) return
    const p: Partial<EqBand> = { freq: clampF(xToF(x)) }
    if (eqUsesGain(b.type)) p.gain = yToDb(y)
    patchBand(dragIndex, p)
  })
  const endDrag = (e: PointerEvent): void => {
    if (dragIndex >= 0 && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    dragIndex = -1
  }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)
  canvas.addEventListener('dblclick', e => {
    const { x, y } = localPt(e)
    const hit = hitTest(x, y)
    if (hit >= 0) patchBand(hit, { on: !bands()[hit].on })
  })
  canvas.addEventListener(
    'wheel',
    e => {
      const { x, y } = localPt(e)
      const hit = hitTest(x, y)
      if (hit < 0) return
      e.preventDefault()
      const q = bands()[hit].q * Math.exp(-e.deltaY * 0.0015)
      patchBand(hit, { q: Math.max(0.1, Math.min(18, q)) })
    },
    { passive: false },
  )

  function draw(): void {
    const g = canvas.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, W, H)
    g.fillStyle = '#161618'
    g.fillRect(0, 0, W, H)

    // grid
    g.strokeStyle = '#2a2a2d'
    g.lineWidth = 1
    g.fillStyle = '#6a6a70'
    g.font = '10px ui-monospace, monospace'
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = fToX(f)
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, H)
      g.stroke()
      g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 2, H - 4)
    }
    for (const db of [-12, -6, 0, 6, 12]) {
      const y = dbToY(db)
      g.strokeStyle = db === 0 ? '#3a3a3f' : '#242427'
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(W, y)
      g.stroke()
      g.fillStyle = '#6a6a70'
      g.fillText(`${db > 0 ? '+' : ''}${db}`, 2, y - 2)
    }

    // live spectrum backdrop
    const ch = app.song?.channel(trackId)
    if (ch) {
      if (!specBuf || specBuf.length !== ch.spectrumBins) specBuf = new Float32Array(ch.spectrumBins)
      ch.spectrum(specBuf)
      const sr = ch.sampleRate
      const nyq = sr / 2
      g.beginPath()
      g.moveTo(0, H)
      for (let i = 1; i < specBuf.length; i++) {
        const f = (i / specBuf.length) * nyq
        if (f < FMIN) continue
        if (f > FMAX) break
        const norm = Math.max(0, Math.min(1, (specBuf[i] + 100) / 100)) // -100..0 dB
        g.lineTo(fToX(f), H - norm * H)
      }
      g.lineTo(W, H)
      g.closePath()
      g.fillStyle = 'rgba(255,106,43,0.10)'
      g.fill()
    }

    // response curve
    const bs = bands()
    g.beginPath()
    for (let px = 0; px <= W; px += 2) {
      const db = eqResponseDb(bs, [xToF(px)], app.song?.channel(trackId)?.sampleRate ?? 44100)[0]
      const y = dbToY(Math.max(-DBMAX, Math.min(DBMAX, db)))
      if (px === 0) g.moveTo(px, y)
      else g.lineTo(px, y)
    }
    g.strokeStyle = '#ff6a2b'
    g.lineWidth = 2
    g.stroke()

    // handles
    bs.forEach((b, i) => {
      const x = fToX(b.freq)
      const y = handleY(b)
      g.beginPath()
      g.arc(x, y, 7, 0, Math.PI * 2)
      g.fillStyle = b.on ? bandColor(i) : '#444448'
      g.fill()
      g.strokeStyle = '#0b0b0c'
      g.lineWidth = 2
      g.stroke()
      g.fillStyle = '#0b0b0c'
      g.font = 'bold 9px ui-monospace, monospace'
      g.fillText(String(i + 1), x - 2.5, y + 3)
    })

    raf = requestAnimationFrame(draw)
  }

  function show(id: string): void {
    trackId = id
    title.textContent = `Equalizer — ${app.project.tracks.find(t => t.id === id)?.name ?? ''}`
    overlay.classList.remove('hidden')
    renderList()
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(draw)
  }
  function hide(): void {
    overlay.classList.add('hidden')
    cancelAnimationFrame(raf)
    raf = 0
  }

  return { open: show }
}

function clampF(f: number): number {
  return Math.round(Math.max(FMIN, Math.min(FMAX, f)))
}
function round1(v: number): number {
  return Math.round(v * 10) / 10
}
function bandColor(i: number): string {
  const hues = [18, 200, 280, 140, 50, 330, 100, 240]
  return `hsl(${hues[i % hues.length]} 75% 58%)`
}

function numField(label: string, value: number, min: number, max: number, set: (v: number) => void): HTMLElement {
  const wrap = document.createElement('label')
  wrap.className = 'eq-num'
  const tag = document.createElement('span')
  tag.textContent = label
  const input = document.createElement('input')
  input.type = 'number'
  input.value = String(value)
  input.min = String(min)
  input.max = String(max)
  input.step = label === 'Q' ? '0.1' : label === 'dB' ? '0.5' : '1'
  input.addEventListener('change', () => {
    const v = Number(input.value)
    if (Number.isFinite(v)) set(Math.max(min, Math.min(max, v)))
  })
  wrap.appendChild(tag)
  wrap.appendChild(input)
  return wrap
}
