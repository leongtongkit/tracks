import '@fontsource/ibm-plex-sans-condensed/600.css'
import '@fontsource/ibm-plex-sans-condensed/700.css'
import '@fontsource/ibm-plex-mono/500.css'

// Style tile: the design language on one screen, built from PRODUCTION
// components (Knob, segmented, power, panel) so what Jay reviews is what ships.

import { CONTINUOUS } from './params/registry'
import { Store } from './state/store'
import { knobRow, panel, panelHeadExtra, power, segmented } from './ui/controls'
import { Knob } from './ui/knob'

const store = new Store()
const tile = document.getElementById('tile')!
const p = (path: string) => CONTINUOUS.find(c => c.path === path)!

const device = document.createElement('div')
device.className = 'device'

// brand strip
const brandRow = document.createElement('div')
brandRow.className = 'brand-row'
brandRow.innerHTML = `
  <span class="brand">SYN<b>TH</b></span>
  <span class="brand-sub">style tile / design language preview</span>
`
device.appendChild(brandRow)

// row of panels exercising the component set
const row = document.createElement('div')
row.style.display = 'flex'
row.style.flexWrap = 'wrap'
row.style.gap = '14px'

const oscPanel = panel(
  'Oscillator 1',
  'coral',
  segmented(store, 'osc.0.wave', ['saw', 'square', 'sine', 'triangle', 'noise'], {
    saw: 'saw',
    square: 'sqr',
    sine: 'sin',
    triangle: 'tri',
    noise: 'nse',
  }),
  knobRow(
    new Knob(p('osc.0.level'), store, { size: 'lg', label: 'Level' }).el,
    new Knob(p('osc.0.octave'), store, { size: 'sm', label: 'Oct' }).el,
    new Knob(p('osc.0.semi'), store, { size: 'sm', label: 'Semi' }).el,
    new Knob(p('osc.0.fine'), store, { size: 'sm', label: 'Fine' }).el,
  ),
)
panelHeadExtra(oscPanel, power(store, 'osc.0.enabled', 'Oscillator 1 on'))

const filterPanel = panel(
  'Filter',
  'coral',
  segmented(store, 'filter.type', ['lowpass', 'highpass', 'bandpass'], {
    lowpass: 'LP',
    highpass: 'HP',
    bandpass: 'BP',
  }),
  knobRow(
    new Knob(p('filter.cutoff'), store, { size: 'lg', label: 'Cutoff' }).el,
    new Knob(p('filter.resonance'), store, { label: 'Reso' }).el,
    new Knob(p('filter.envAmount'), store, { label: 'Env' }).el,
  ),
)

const lfoPanel = panel(
  'LFO 1',
  'teal',
  segmented(store, 'lfo.0.wave', ['sine', 'triangle', 'square', 'sawtooth'], {
    sine: 'sin',
    triangle: 'tri',
    square: 'sqr',
    sawtooth: 'saw',
  }),
  knobRow(
    new Knob(p('lfo.0.rate'), store, { accent: 'teal', label: 'Rate' }).el,
    new Knob(p('lfo.0.targets.filter'), store, { accent: 'teal', label: 'Filter' }).el,
    new Knob(p('lfo.0.targets.pitch'), store, { accent: 'teal', size: 'sm', label: 'Pitch' }).el,
  ),
)

const fxPanel = panel(
  'Delay',
  'amber',
  knobRow(
    new Knob(p('fx.delay.time'), store, { accent: 'amber', label: 'Time' }).el,
    new Knob(p('fx.delay.feedback'), store, { accent: 'amber', label: 'Fdbk' }).el,
    new Knob(p('fx.delay.mix'), store, { accent: 'amber', label: 'Mix' }).el,
  ),
)
panelHeadExtra(fxPanel, power(store, 'fx.delay.on', 'Delay on'))

row.appendChild(oscPanel)
row.appendChild(filterPanel)
row.appendChild(lfoPanel)
row.appendChild(fxPanel)
device.appendChild(row)

// piano fragment (one octave, visual only on the tile)
const shell = document.createElement('div')
shell.className = 'piano-shell'
const piano = document.createElement('div')
piano.className = 'piano'
const blackAfter = new Set([0, 1, 3, 4, 5])
const hints = ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
for (let i = 0; i < 7; i++) {
  const w = document.createElement('div')
  w.className = 'key-w'
  w.innerHTML = `<span class="key-hint">${hints[i]}</span>`
  if (i === 2) w.classList.add('key-down')
  piano.appendChild(w)
}
for (const slot of blackAfter) {
  const b = document.createElement('div')
  b.className = 'key-b'
  b.style.left = `${(slot + 1) * (100 / 7) - 3.75}%`
  piano.appendChild(b)
}
shell.appendChild(piano)
device.appendChild(shell)

tile.appendChild(device)
