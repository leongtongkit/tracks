import { Sequencer, STEP_COUNT } from '../sequencer/sequencer'
import { CONTINUOUS } from '../params/registry'
import type { Store } from '../state/store'
import { Knob } from './knob'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function noteName(semi: number): string {
  return `${NOTE_NAMES[semi % 12]}${semi >= 12 ? '+' : ''}`
}

// Step grid: click toggles a step, vertical drag changes its pitch.
export function buildSequencer(store: Store, seq: Sequencer): HTMLElement {
  const wrap = document.createElement('section')
  wrap.className = 'seq-strip'

  // transport
  const transport = document.createElement('div')
  transport.className = 'seq-transport'
  const playBtn = document.createElement('button')
  playBtn.type = 'button'
  playBtn.className = 'seg-btn seq-play'
  playBtn.textContent = 'Play'
  playBtn.addEventListener('click', () => {
    const playing = seq.toggle()
    playBtn.textContent = playing ? 'Stop' : 'Play'
    playBtn.classList.toggle('seg-on', playing)
    if (!playing) clearPlayhead()
  })
  const clearBtn = document.createElement('button')
  clearBtn.type = 'button'
  clearBtn.className = 'seg-btn'
  clearBtn.textContent = 'Clear'
  clearBtn.addEventListener('click', () => {
    seq.clear()
    cells.forEach((cell, i) => render(cell, i))
  })
  const bpmParam = CONTINUOUS.find(p => p.path === 'master.bpm')!
  const bpmKnob = new Knob(bpmParam, store, { size: 'sm', accent: 'teal', label: 'BPM' })
  transport.appendChild(playBtn)
  transport.appendChild(clearBtn)
  transport.appendChild(bpmKnob.el)
  wrap.appendChild(transport)

  // step cells
  const grid = document.createElement('div')
  grid.className = 'seq-grid'
  const cells: HTMLButtonElement[] = []

  const render = (cell: HTMLButtonElement, i: number): void => {
    const step = seq.steps[i]
    cell.classList.toggle('seq-on', step.on)
    ;(cell.querySelector('.seq-note') as HTMLElement).textContent = step.on ? noteName(step.semi) : ''
  }

  for (let i = 0; i < STEP_COUNT; i++) {
    const cell = document.createElement('button')
    cell.type = 'button'
    cell.className = 'seq-cell'
    if (i % 4 === 0) cell.classList.add('seq-beat')
    cell.innerHTML = `<span class="seq-note"></span>`
    cell.setAttribute('aria-label', `Step ${i + 1}`)

    let startY = 0
    let startSemi = 0
    let dragged = false
    let pid: number | null = null
    cell.addEventListener('pointerdown', e => {
      e.preventDefault()
      pid = e.pointerId
      startY = e.clientY
      startSemi = seq.steps[i].semi
      dragged = false
      try {
        cell.setPointerCapture(e.pointerId)
      } catch {
        // synthetic events
      }
    })
    cell.addEventListener('pointermove', e => {
      if (pid !== e.pointerId) return
      const dy = startY - e.clientY
      if (Math.abs(dy) > 5) {
        dragged = true
        const semi = Math.max(0, Math.min(24, startSemi + Math.round(dy / 8)))
        seq.setStep(i, { semi, on: true })
        render(cell, i)
      }
    })
    const up = (e: PointerEvent): void => {
      if (pid !== e.pointerId) return
      pid = null
      if (!dragged) {
        seq.setStep(i, { on: !seq.steps[i].on })
        render(cell, i)
      }
    }
    cell.addEventListener('pointerup', up)
    cell.addEventListener('pointercancel', up)

    cells.push(cell)
    grid.appendChild(cell)
    render(cell, i)
  }
  wrap.appendChild(grid)

  // playhead: highlight scheduled steps when their time arrives
  let lastLit = -1
  const clearPlayhead = (): void => {
    if (lastLit >= 0) cells[lastLit].classList.remove('seq-lit')
    lastLit = -1
  }
  seq.onStepUI = (index, waitMs) => {
    setTimeout(() => {
      if (!seq.playing) return
      if (lastLit >= 0) cells[lastLit].classList.remove('seq-lit')
      cells[index].classList.add('seq-lit')
      lastLit = index
    }, waitMs)
  }

  return wrap
}
