// Draws sheet music with abcjs (MIT) and moves a cursor along it with the
// studio's own transport (or any other clock). Loaded only when sheet music is
// shown: abcjs is large, and the studio's first load must not pay for it.
// The sheet music editor also uses it to pick notes by clicking them.
import type { NoteTimingEvent } from 'abcjs'
import renderAbc from 'abcjs/src/api/abc_tunebook_svg'

export interface DrawnSheet {
  notes: number
  /** highlight what was written between these two places in the ABC text */
  select(start: number, end: number): void
  destroy(): void
}

export interface SheetOptions {
  /** a note, rest or bar was clicked: where it is written in the ABC text */
  onClick?(start: number, end: number): void
  selectionColor?: string
}

interface Moment {
  beat: number
  left: number
  top: number
  height: number
  line: number
  els: Element[]
}

const SVG = 'http://www.w3.org/2000/svg'

// `qpm` is the Q: tempo written in the ABC; `position` returns the song beat
// (quarter notes from the start of the song, as the transport counts them).
export function drawSheet(target: HTMLElement, abc: string, qpm: number, position: () => number, opts: SheetOptions = {}): DrawnSheet {
  target.textContent = ''
  const { onClick } = opts
  const [tune] = renderAbc(target, abc, {
    responsive: 'resize', add_classes: true, paddingleft: 4, paddingright: 4, paddingtop: 8,
    ...(onClick ? { clickListener: el => { if (el.startChar !== undefined && el.endChar !== undefined) onClick(el.startChar, el.endChar) } } : {}),
    ...(opts.selectionColor ? { selectionColor: opts.selectionColor } : {}),
  })
  const svg = target.querySelector('svg')
  if (!tune || !svg) throw new Error('abcjs drew nothing')
  // abcjs times events at the tune's own Q: tempo; turn them back into beats
  const moments: Moment[] = []
  let end = Infinity
  tune.setTiming() // fills tune.noteTimings (the typings say it returns nothing)
  for (const ev of (tune as unknown as { noteTimings: NoteTimingEvent[] }).noteTimings ?? []) {
    const beat = (ev.milliseconds / 60000) * qpm
    if (ev.type === 'end') { end = beat; continue }
    if (ev.left === undefined || ev.top === undefined || ev.height === undefined) continue
    moments.push({ beat, left: ev.left, top: ev.top, height: ev.height, line: ev.line ?? 0, els: (ev.elements ?? []).flat() as Element[] })
  }
  const cursor = document.createElementNS(SVG, 'line')
  cursor.setAttribute('class', 'sheet-cursor')
  svg.appendChild(cursor)
  let shown: Moment | null = null
  let frame = 0
  const tick = (): void => {
    const beat = position()
    let lo = 0, hi = moments.length - 1, at = -1
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (moments[mid].beat <= beat + 1e-6) { at = mid; lo = mid + 1 } else hi = mid - 1 }
    const m = at >= 0 && beat < end ? moments[at] : null
    if (m !== shown) {
      shown?.els.forEach(el => el.classList.remove('sheet-now'))
      cursor.style.display = m ? '' : 'none'
      if (m) {
        m.els.forEach(el => el.classList.add('sheet-now'))
        cursor.setAttribute('x1', String(m.left - 2)); cursor.setAttribute('x2', String(m.left - 2))
        cursor.setAttribute('y1', String(m.top)); cursor.setAttribute('y2', String(m.top + m.height))
        if (shown && m.line !== shown.line) m.els[0]?.scrollIntoView({ block: 'nearest' })
      }
      shown = m
    }
    frame = requestAnimationFrame(tick)
  }
  tick()
  const engraver = (tune as unknown as { engraver?: { rangeHighlight(start: number, end: number): void } }).engraver
  return {
    notes: target.querySelectorAll('.abcjs-note').length,
    select: (start, end) => engraver?.rangeHighlight(start, end),
    destroy: () => cancelAnimationFrame(frame),
  }
}
