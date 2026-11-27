import { hashToSong } from '../daw/share-link'
import { renderProject } from '../daw/render'
import { track } from '../daw/analytics'
import { setPendingSong } from './pending'
import './player.css'

type PlayerState = { state: 'loading' | 'ready' | 'playing' | 'error'; peak: number; durationSec: number }
declare global { interface Window { __tracksPlayer: PlayerState } }

export async function showPlayer(device: 'phone' | 'desktop' | 'embed'): Promise<void> {
  const root = document.getElementById('app')!
  root.replaceChildren()
  const card = document.createElement('section')
  card.className = `shared-player ${device === 'embed' ? 'compact' : ''}`
  root.appendChild(card)
  window.__tracksPlayer = { state: 'loading', peak: 0, durationSec: 0 }
  const song = await hashToSong(location.hash)
  if (!song) {
    window.__tracksPlayer.state = 'error'
    card.innerHTML = '<p>This link doesn\'t contain a song we can open.</p><a href="/studio">Open the studio</a>'
    return
  }
  track('shared_open', { device })
  const label = document.createElement('div')
  label.className = 'player-label'
  const title = document.createElement('h1')
  title.textContent = song.name
  const subtitle = document.createElement('p')
  subtitle.textContent = 'Shared from Tracks'
  label.append(title, subtitle)
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Getting the song ready…'
  button.disabled = true
  const progress = document.createElement('progress')
  progress.max = 1
  progress.value = 0
  progress.setAttribute('aria-label', 'Song progress')
  const time = document.createElement('span')
  time.textContent = '0:00'
  const controls = document.createElement('div')
  controls.className = 'player-controls'
  controls.append(button, progress, time)
  let stopPlayback = (): void => {}
  const actions = document.createElement('div')
  actions.className = 'player-actions'
  if (device === 'desktop') {
    const remix = document.createElement('button')
    remix.textContent = 'Remix this'
    remix.className = 'player-remix'
    remix.addEventListener('click', () => {
      stopPlayback()
      setPendingSong(song)
      root.replaceChildren()
      void import('../daw/boot')
    })
    const studio = document.createElement('a')
    studio.href = '/studio'
    studio.textContent = 'Open the studio'
    actions.append(remix, studio)
  } else if (device === 'phone') {
    actions.textContent = 'Open this link on a computer to remix it.'
  } else {
    const link = document.createElement('a')
    link.href = 'https://freetracks.app/studio' + location.hash
    link.target = '_blank'
    link.rel = 'noopener'
    link.textContent = 'Make your own on Tracks'
    actions.append(link)
  }
  card.append(label, controls, actions)
  try {
    const buffer = await renderProject(song)
    let peak = 0
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel)
      for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
    }
    window.__tracksPlayer = { state: 'ready', peak, durationSec: buffer.duration }
    button.textContent = 'Play'
    button.disabled = false
    let context: AudioContext | null = null
    let source: AudioBufferSourceNode | null = null
    let start = 0
    let animation = 0
    const reset = (): void => {
      source = null
      cancelAnimationFrame(animation)
      progress.value = 0
      time.textContent = '0:00'
      button.textContent = 'Play'
      window.__tracksPlayer.state = 'ready'
    }
    stopPlayback = () => { if (source) { source.onended = null; source.stop(); reset() } }
    const tick = (): void => {
      if (!context || !source) return
      const elapsed = Math.min(buffer.duration, context.currentTime - start)
      progress.value = elapsed / buffer.duration
      time.textContent = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`
      animation = requestAnimationFrame(tick)
    }
    button.addEventListener('click', () => {
      if (source) { source.onended = null; source.stop(); reset(); return }
      context ??= new AudioContext()
      void context.resume()
      source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      source.onended = reset
      start = context.currentTime
      source.start()
      button.textContent = 'Stop'
      window.__tracksPlayer.state = 'playing'
      if (device === 'embed') track('embed_play')
      tick()
    })
  } catch {
    window.__tracksPlayer.state = 'error'
    button.textContent = 'Could not prepare this song.'
  }
}
