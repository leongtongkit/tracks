// Pure logic for the drum step grid: 16 sixteenth-note steps per bar page,
// mapping between steps and clip notes. Note starts are clip-relative beats.

import { STEP_COUNT } from '../sequencer/sequencer'
import { DRUM_ORDER } from './instruments/drums'
import type { Note } from './project'

export const STEP_BEATS = 0.25
export const PAGE_BEATS = STEP_COUNT * STEP_BEATS // one bar of 16 steps = 4 beats
const EPS = 1e-6

export interface DrumRow {
  pitch: number
  label: string
}

const TOP_ROWS = ['kick', 'snare', 'hatc', 'hato']

// Kick, Snare, Hat Closed, Hat Open first, then the rest in kit order
export function drumRows(): DrumRow[] {
  const top = TOP_ROWS.map(id => DRUM_ORDER.find(d => d.id === id)!)
  const rest = DRUM_ORDER.filter(d => !TOP_ROWS.includes(d.id))
  return [...top, ...rest].map(d => ({ pitch: d.pitch, label: d.label }))
}

export function pageCount(clipLength: number): number {
  return Math.max(1, Math.ceil(clipLength / PAGE_BEATS - EPS))
}

// clip-relative start of a step, in beats
export function stepStart(page: number, step: number): number {
  return page * PAGE_BEATS + step * STEP_BEATS
}

// a step can be clicked only if it begins inside the clip
export function stepInClip(clipLength: number, page: number, step: number): boolean {
  return stepStart(page, step) < clipLength - EPS
}

// which page/step a clip-relative beat falls in, or null outside the clip
export function stepAtBeat(clipLength: number, beat: number): { page: number; step: number } | null {
  if (beat < 0 || beat >= clipLength) return null
  const n = Math.floor(beat / STEP_BEATS + EPS)
  return { page: Math.floor(n / STEP_COUNT), step: n % STEP_COUNT }
}

// a note shows in the step it starts in, even when it is off the 16th grid
export function noteInStep(note: Note, page: number, step: number): boolean {
  const s = stepStart(page, step)
  return note.start >= s - EPS && note.start < s + STEP_BEATS - EPS
}

export function isStepOn(notes: Note[], pitch: number, page: number, step: number): boolean {
  return notes.some(n => n.pitch === pitch && noteInStep(n, page, step))
}

// Turn a step on or off. Returns a new notes array (the input is untouched)
// and whether a note was added or removed; 'none' for steps outside the clip.
export function toggleStep(
  notes: Note[],
  pitch: number,
  page: number,
  step: number,
  clipLength: number,
): { notes: Note[]; result: 'added' | 'removed' | 'none' } {
  if (!stepInClip(clipLength, page, step)) return { notes, result: 'none' }
  if (isStepOn(notes, pitch, page, step)) {
    return { notes: notes.filter(n => !(n.pitch === pitch && noteInStep(n, page, step))), result: 'removed' }
  }
  const start = stepStart(page, step)
  const note: Note = { pitch, start, dur: Math.min(STEP_BEATS, clipLength - start), vel: 0.8 }
  return { notes: [...notes, note], result: 'added' }
}
