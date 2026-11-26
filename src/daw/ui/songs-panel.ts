// Songs panel: rename the song, start a new one (empty or from a starter), and
// open or delete the songs kept in this browser. Same card style as the help
// and settings panels; Esc, Close and a click outside all close it.

import type { DawApp } from '../daw-app'
import type { SongLibrary } from '../library'
import { TEMPLATE_IDS, TEMPLATE_LABELS, type TemplateId } from '../templates'
import { confirmStart } from './start-confirm'

export interface SongsPanelDeps {
  app: DawApp
  library: SongLibrary
  startEmpty(): void
  startTemplate(id: TemplateId): void
  openSong(id: string): void
}

export interface SongsPanel {
  toggle(): void
  close(): void
  refresh(): void
}

export function songTitle(name: string): string {
  return name.trim() || 'Untitled'
}

export function buildSongsPanel(deps: SongsPanelDeps): SongsPanel {
  const { app, library } = deps
  const overlay = document.createElement('div')
  overlay.className = 'help-overlay hidden'
  const card = document.createElement('div')
  card.className = 'help-card songs-card'
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-label', 'Songs')
  card.addEventListener('click', e => e.stopPropagation())

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'seg-btn help-close help-close-top'
  close.textContent = 'Close'
  card.appendChild(close)

  const title = document.createElement('h2')
  title.textContent = 'Songs'
  card.appendChild(title)

  const heading = (text: string): HTMLElement => {
    const h = document.createElement('h3')
    h.className = 'songs-heading'
    h.textContent = text
    card.appendChild(h)
    return h
  }

  heading('Song name')
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.className = 'songs-name'
  nameInput.maxLength = 60
  nameInput.setAttribute('aria-label', 'Song name')
  nameInput.addEventListener('input', () => {
    app.checkpoint('rename song')
    app.project.name = nameInput.value.slice(0, 60)
    app.emit('project')
  })
  nameInput.addEventListener('change', () => {
    if (!nameInput.value.trim()) {
      app.checkpoint('rename song')
      app.project.name = 'Untitled'
      nameInput.value = 'Untitled'
      app.emit('project')
    }
  })
  card.appendChild(nameInput)

  heading('Start a new song')
  const starters = document.createElement('div')
  starters.className = 'songs-starters'
  const starter = (label: string, run: () => void): void => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'seg-btn'
    b.textContent = label
    b.addEventListener('click', run)
    starters.appendChild(b)
  }
  starter('New empty song', () => deps.startEmpty())
  for (const id of TEMPLATE_IDS) starter(TEMPLATE_LABELS[id], () => deps.startTemplate(id))
  card.appendChild(starters)

  heading('My songs in this browser')
  const list = document.createElement('ul')
  list.className = 'songs-list'
  card.appendChild(list)

  const render = (): void => {
    if (document.activeElement !== nameInput) nameInput.value = app.project.name
    list.textContent = ''
    const songs = library.list()
    if (!songs.length) {
      const empty = document.createElement('li')
      empty.className = 'songs-empty'
      empty.textContent = 'No songs kept here yet. Songs you work on are kept here while autosave is on.'
      list.appendChild(empty)
      return
    }
    const current = library.currentId()
    for (const s of songs) {
      const li = document.createElement('li')
      li.className = 'songs-row'
      const info = document.createElement('span')
      info.className = 'songs-info'
      const name = document.createElement('span')
      name.className = 'songs-title'
      name.textContent = songTitle(s.name) + (s.id === current ? ' (open now)' : '')
      const when = document.createElement('span')
      when.className = 'songs-when'
      when.textContent = new Date(s.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      info.append(name, when)
      const open = document.createElement('button')
      open.type = 'button'
      open.className = 'seg-btn'
      open.textContent = 'Open'
      open.addEventListener('click', () => deps.openSong(s.id))
      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'seg-btn'
      del.textContent = 'Delete'
      del.addEventListener('click', () => {
        confirmStart(`Delete “${songTitle(s.name)}” from this browser? This cannot be undone.`, 'Delete', () => {
          library.remove(s.id)
          render()
        })
      })
      li.append(info, open, del)
      list.appendChild(li)
    }
  }

  const hide = (): void => overlay.classList.add('hidden')
  close.addEventListener('click', hide)
  overlay.addEventListener('click', e => {
    if (e.target === overlay) hide()
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hide()
  })
  overlay.appendChild(card)
  document.body.appendChild(overlay)
  app.on('project', () => {
    if (!overlay.classList.contains('hidden')) render()
  })

  return {
    toggle: () => {
      overlay.classList.toggle('hidden')
      if (!overlay.classList.contains('hidden')) render()
    },
    close: hide,
    refresh: render,
  }
}
