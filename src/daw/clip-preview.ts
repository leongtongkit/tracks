// Geometry for the little note drawing inside an arrangement clip: time runs
// left to right, pitch bottom to top, scaled to the clip's own pitch range.

import type { Note } from './project'

export interface PreviewRect {
  x: number
  y: number
  w: number
  h: number
  vel: number
}

const MAX_ROW_H = 6
const MIN_W = 2

export function previewRects(notes: Note[], length: number, width: number, height: number): PreviewRect[] {
  if (!notes.length || length <= 0 || width <= 0 || height <= 0) return []
  let lo = Infinity
  let hi = -Infinity
  for (const n of notes) {
    if (n.pitch < lo) lo = n.pitch
    if (n.pitch > hi) hi = n.pitch
  }
  const rows = hi - lo + 1
  const rowH = Math.min(MAX_ROW_H, height / rows)
  const used = Math.min(height, rows * rowH)
  const top = (height - used) / 2 // a narrow range sits in the middle
  const pxPerBeat = width / length
  const out: PreviewRect[] = []
  for (const n of notes) {
    if (n.start >= length) continue
    const x = n.start * pxPerBeat
    const w = Math.max(MIN_W, Math.min(n.dur, length - n.start) * pxPerBeat - 0.5)
    const y = rows === 1 ? top : top + ((hi - n.pitch) / rows) * used
    out.push({ x, y, w: Math.min(w, width - x), h: rowH - (rowH > 3 ? 0.5 : 0), vel: n.vel })
  }
  return out
}
