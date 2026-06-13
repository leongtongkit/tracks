// Session view: a scenes × tracks grid of clip slots. Launch a slot to loop it
// on its track (overriding the arrangement, quantised to the next bar); launch a
// scene row to fire the whole row. Fill an empty slot from the selected
// arrangement clip (or a new empty clip). Toggled from the transport bar.

import type { DawApp } from '../daw-app'

export function buildSessionGrid(app: DawApp): { toggle(): void } {
  const overlay = document.createElement('div')
  overlay.className = 'help-overlay hidden'
  const card = document.createElement('div')
  card.className = 'help-card session-card'
  card.addEventListener('click', e => e.stopPropagation())

  const head = document.createElement('div')
  head.className = 'session-head'
  const title = document.createElement('h2')
  title.textContent = 'Session'
  head.appendChild(title)
  const stopAll = document.createElement('button')
  stopAll.type = 'button'
  stopAll.className = 'seg-btn'
  stopAll.textContent = 'Stop all'
  stopAll.addEventListener('click', () => app.stopAllSession())
  head.appendChild(stopAll)
  const addScene = document.createElement('button')
  addScene.type = 'button'
  addScene.className = 'seg-btn'
  addScene.textContent = '+ Scene'
  addScene.addEventListener('click', () => app.addScene())
  head.appendChild(addScene)
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'help-close'
  close.textContent = 'Done'
  close.addEventListener('click', () => hide())
  head.appendChild(close)
  card.appendChild(head)

  const grid = document.createElement('div')
  grid.className = 'session-grid'
  card.appendChild(grid)

  const hint = document.createElement('p')
  hint.className = 'audio-hint'
  hint.textContent = 'Click a clip to launch it (loops from the next bar); click again to stop. ▶ on a scene row launches every clip in it. Fill an empty slot with the clip selected in the arrangement, or a blank 4-beat clip.'
  card.appendChild(hint)

  overlay.appendChild(card)
  overlay.addEventListener('click', () => hide())
  document.body.appendChild(overlay)

  let open = false

  const sceneCount = (): number => {
    let n = Math.max(4, app.project.scenes.length)
    for (const t of app.project.tracks) n = Math.max(n, t.session.length)
    return n
  }

  function render(): void {
    grid.innerHTML = ''
    const tracks = app.project.tracks
    grid.style.gridTemplateColumns = `120px repeat(${tracks.length}, minmax(110px, 1fr))`

    // header row: empty corner + track names
    grid.appendChild(cell('session-corner', 'Scenes'))
    for (const t of tracks) grid.appendChild(cell('session-track-head', t.name))

    const scenes = sceneCount()
    for (let s = 0; s < scenes; s++) {
      // scene launch + name
      const sceneCell = document.createElement('div')
      sceneCell.className = 'session-scene'
      const launch = document.createElement('button')
      launch.type = 'button'
      launch.className = 'session-scene-launch'
      launch.textContent = '▶'
      launch.title = 'Launch every clip in this scene'
      launch.addEventListener('click', () => app.launchScene(s))
      const name = document.createElement('span')
      name.textContent = app.project.scenes[s]?.name ?? `Scene ${s + 1}`
      sceneCell.appendChild(launch)
      sceneCell.appendChild(name)
      grid.appendChild(sceneCell)

      // a slot per track
      for (const t of tracks) {
        const clip = t.session[s] ?? null
        const slot = document.createElement('div')
        slot.className = 'session-slot' + (clip ? ' session-filled' : ' session-empty')
        const playing = app.isSlotPlaying(t.id, s)
        if (playing) slot.classList.add('session-playing')
        if (clip) {
          const play = document.createElement('button')
          play.type = 'button'
          play.className = 'session-clip'
          play.textContent = playing ? '■ playing' : `▶ ${clip.notes.length ? `${clip.notes.length} notes` : clip.audio ? 'audio' : 'clip'}`
          play.title = playing ? 'Stop' : 'Launch this clip'
          play.addEventListener('click', () => (playing ? app.stopSlot(t.id) : app.launchSlot(t.id, s)))
          slot.appendChild(play)
          const clr = document.createElement('button')
          clr.type = 'button'
          clr.className = 'session-clear'
          clr.textContent = '×'
          clr.title = 'Clear this slot'
          clr.addEventListener('click', () => app.clearSlot(t.id, s))
          slot.appendChild(clr)
        } else {
          const add = document.createElement('button')
          add.type = 'button'
          add.className = 'session-add'
          add.textContent = '+'
          add.title = 'Fill from the selected arrangement clip (or a blank clip)'
          add.addEventListener('click', () => app.captureToSlot(t.id, s))
          slot.appendChild(add)
        }
        grid.appendChild(slot)
      }
    }
  }

  function cell(cls: string, text: string): HTMLElement {
    const el = document.createElement('div')
    el.className = cls
    el.textContent = text
    return el
  }

  // keep the grid live while open (launch state + track changes)
  const refresh = (): void => {
    if (open) render()
  }
  app.on('tracks', refresh)
  app.on('transport', refresh)

  function hide(): void {
    open = false
    overlay.classList.add('hidden')
  }

  return {
    toggle(): void {
      open = !open
      if (open) {
        render()
        overlay.classList.remove('hidden')
      } else {
        overlay.classList.add('hidden')
      }
    },
  }
}
