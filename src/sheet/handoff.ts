// Passing a score between the studio and the sheet music editor in the same
// browser. It stays on the device: written just before the page changes, read
// once by the page it was meant for, and ignored if it is old.
const KEY = 'tracks.sheet.handoff.v1'
const FRESH_MS = 10 * 60 * 1000

export type HandoffTo = 'studio' | 'sheet-music'
export interface Score { text: string; name: string }

export function sendScore(to: HandoffTo, score: Score): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ to, text: score.text, name: score.name, at: Date.now() }))
    return true
  } catch {
    return false
  }
}

export function takeScore(to: HandoffTo): Score | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const h = JSON.parse(raw) as { to?: unknown; text?: unknown; name?: unknown; at?: unknown }
    if (h.to !== to) return null
    localStorage.removeItem(KEY)
    if (typeof h.text !== 'string' || typeof h.name !== 'string' || typeof h.at !== 'number' || Date.now() - h.at > FRESH_MS) return null
    return { text: h.text, name: h.name }
  } catch {
    return null
  }
}
