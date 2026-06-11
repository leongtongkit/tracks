// Full instrument surface: oscillators, filter, envelopes, voice/FM, LFOs, FX rack.

import { CONTINUOUS, type ContinuousParam } from '../params/registry'
import type { Store } from '../state/store'
import { knobRow, panel, panelHeadExtra, power, segmented } from './controls'
import { Knob, type KnobAccent, type KnobSize } from './knob'

const byPath = new Map<string, ContinuousParam>(CONTINUOUS.map(p => [p.path, p]))

function knob(
  store: Store,
  path: string,
  opts: { size?: KnobSize; accent?: KnobAccent; label?: string } = {},
): HTMLElement {
  const param = byPath.get(path)
  if (!param) throw new Error(`unknown param ${path}`)
  return new Knob(param, store, opts).el
}

const WAVE_LABELS = { saw: 'saw', square: 'sqr', sine: 'sin', triangle: 'tri', noise: 'nse', sawtooth: 'saw' }

function oscPanel(store: Store, i: number): HTMLElement {
  const el = panel(
    `OSC ${i + 1}`,
    'coral',
    segmented(store, `osc.${i}.wave`, ['saw', 'square', 'sine', 'triangle', 'noise'], WAVE_LABELS),
    knobRow(
      knob(store, `osc.${i}.level`, { size: 'lg', label: 'Level' }),
      knob(store, `osc.${i}.octave`, { size: 'sm', label: 'Oct' }),
      knob(store, `osc.${i}.semi`, { size: 'sm', label: 'Semi' }),
      knob(store, `osc.${i}.fine`, { size: 'sm', label: 'Fine' }),
    ),
  )
  panelHeadExtra(el, power(store, `osc.${i}.enabled`, `Oscillator ${i + 1} on`))
  return el
}

function filterPanel(store: Store): HTMLElement {
  return panel(
    'Filter',
    'coral',
    segmented(store, 'filter.type', ['lowpass', 'highpass', 'bandpass'], {
      lowpass: 'LP',
      highpass: 'HP',
      bandpass: 'BP',
    }),
    knobRow(
      knob(store, 'filter.cutoff', { size: 'lg', label: 'Cutoff' }),
      knob(store, 'filter.resonance', { label: 'Reso' }),
      knob(store, 'filter.envAmount', { label: 'Env' }),
      knob(store, 'filter.keyTrack', { size: 'sm', label: 'Track' }),
    ),
  )
}

function envPanel(store: Store, kind: 'amp' | 'filter'): HTMLElement {
  return panel(
    kind === 'amp' ? 'Amp Env' : 'Filter Env',
    'coral',
    knobRow(
      knob(store, `env.${kind}.a`, { size: 'sm', label: 'Atk' }),
      knob(store, `env.${kind}.d`, { size: 'sm', label: 'Dec' }),
      knob(store, `env.${kind}.s`, { size: 'sm', label: 'Sus' }),
      knob(store, `env.${kind}.r`, { size: 'sm', label: 'Rel' }),
    ),
  )
}

function voicePanel(store: Store): HTMLElement {
  const el = panel(
    'Voice + FM',
    'teal',
    segmented(store, 'voice.mode', ['poly', 'mono', 'legato']),
    knobRow(
      knob(store, 'voice.glide', { accent: 'teal', size: 'sm', label: 'Glide' }),
      knob(store, 'fm.ratio', { accent: 'teal', size: 'sm', label: 'FM Rat' }),
      knob(store, 'fm.depth', { accent: 'teal', size: 'sm', label: 'FM Dep' }),
    ),
  )
  panelHeadExtra(el, power(store, 'fm.enabled', 'FM on'))
  return el
}

function lfoPanel(store: Store, i: number): HTMLElement {
  return panel(
    `LFO ${i + 1}`,
    'teal',
    segmented(store, `lfo.${i}.wave`, ['sine', 'triangle', 'square', 'sawtooth'], WAVE_LABELS),
    knobRow(
      knob(store, `lfo.${i}.rate`, { accent: 'teal', label: 'Rate' }),
      knob(store, `lfo.${i}.targets.pitch`, { accent: 'teal', size: 'sm', label: 'Pitch' }),
      knob(store, `lfo.${i}.targets.filter`, { accent: 'teal', size: 'sm', label: 'Filter' }),
      knob(store, `lfo.${i}.targets.amp`, { accent: 'teal', size: 'sm', label: 'Amp' }),
    ),
  )
}

const FX_DEFS: { id: string; name: string; knobs: [string, string][] }[] = [
  { id: 'distortion', name: 'Drive', knobs: [['drive', 'Drive'], ['tone', 'Tone'], ['mix', 'Mix']] },
  { id: 'bitcrusher', name: 'Crush', knobs: [['bits', 'Bits'], ['downsample', 'Rate'], ['mix', 'Mix']] },
  { id: 'chorus', name: 'Chorus', knobs: [['rate', 'Rate'], ['depth', 'Depth'], ['mix', 'Mix']] },
  { id: 'phaser', name: 'Phaser', knobs: [['rate', 'Rate'], ['depth', 'Depth'], ['mix', 'Mix']] },
  { id: 'delay', name: 'Delay', knobs: [['time', 'Time'], ['feedback', 'Fdbk'], ['mix', 'Mix']] },
  { id: 'reverb', name: 'Reverb', knobs: [['size', 'Size'], ['decay', 'Decay'], ['mix', 'Mix']] },
]

function fxRack(store: Store): HTMLElement {
  const rack = document.createElement('section')
  rack.className = 'fx-rack'
  for (const def of FX_DEFS) {
    const mod = document.createElement('div')
    mod.className = 'fx-mod'
    const head = document.createElement('div')
    head.className = 'fx-mod-head'
    const name = document.createElement('h3')
    name.textContent = def.name
    head.appendChild(name)
    head.appendChild(power(store, `fx.${def.id}.on`, `${def.name} on`))
    mod.appendChild(head)
    mod.appendChild(
      knobRow(
        ...def.knobs.map(([key, label]) =>
          knob(store, `fx.${def.id}.${key}`, { accent: 'amber', size: 'sm', label }),
        ),
      ),
    )
    rack.appendChild(mod)
  }
  return rack
}

export interface AppCallbacks {
  octaveDown(): void
  octaveUp(): void
}

export interface AppRefs {
  octaveReadout: HTMLElement
  pianoSlot: HTMLElement
  presetSlot: HTMLElement
}

export function buildApp(root: HTMLElement, store: Store, cb: AppCallbacks): AppRefs {
  const device = document.createElement('div')
  device.className = 'device'

  // brand strip
  const brandRow = document.createElement('div')
  brandRow.className = 'brand-row'
  const brand = document.createElement('span')
  brand.className = 'brand'
  brand.innerHTML = 'SYN<b>TH</b>'
  const presetSlot = document.createElement('div')
  presetSlot.className = 'preset-slot'
  const masterKnob = knob(store, 'master.gain', { size: 'sm', accent: 'ink', label: 'Vol' })
  masterKnob.classList.add('master-knob')
  brandRow.appendChild(brand)
  brandRow.appendChild(presetSlot)
  brandRow.appendChild(masterKnob)
  device.appendChild(brandRow)

  // module grid
  const grid = document.createElement('div')
  grid.className = 'module-grid'
  grid.appendChild(oscPanel(store, 0))
  grid.appendChild(oscPanel(store, 1))
  grid.appendChild(oscPanel(store, 2))
  grid.appendChild(filterPanel(store))
  grid.appendChild(envPanel(store, 'amp'))
  grid.appendChild(envPanel(store, 'filter'))
  grid.appendChild(voicePanel(store))
  grid.appendChild(lfoPanel(store, 0))
  grid.appendChild(lfoPanel(store, 1))
  device.appendChild(grid)

  device.appendChild(fxRack(store))

  // piano row with octave controls
  const pianoRow = document.createElement('div')
  pianoRow.className = 'piano-row'
  const octCtl = document.createElement('div')
  octCtl.className = 'oct-ctl'
  const down = document.createElement('button')
  down.type = 'button'
  down.className = 'seg-btn'
  down.textContent = 'Oct -'
  down.title = 'Octave down (Arrow Down)'
  down.addEventListener('click', cb.octaveDown)
  const up = document.createElement('button')
  up.type = 'button'
  up.className = 'seg-btn'
  up.textContent = 'Oct +'
  up.title = 'Octave up (Arrow Up)'
  up.addEventListener('click', cb.octaveUp)
  const octaveReadout = document.createElement('span')
  octaveReadout.className = 'oct-readout'
  octaveReadout.textContent = 'C4'
  octCtl.appendChild(down)
  octCtl.appendChild(octaveReadout)
  octCtl.appendChild(up)
  const pianoSlot = document.createElement('div')
  pianoSlot.className = 'piano-slot'
  pianoRow.appendChild(octCtl)
  pianoRow.appendChild(pianoSlot)
  device.appendChild(pianoRow)

  root.appendChild(device)
  return { octaveReadout, pianoSlot, presetSlot }
}
