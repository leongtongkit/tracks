import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { smf } from '../tests/sheet/smf'
import { expect, songState, test, transportState, waitForStudio } from './fixtures'

const SCORE = 'e2e/yue2/score.abc'
const FIRST_LINE = '"C"E2G2A2G2E2D2C4|"G"D2E2G2E2D2C2D4|"Am"E2G2A2c2B2A2G4|"F"F2E2D2E2G2E2C4|'
const RAISED_LINE = '"C"F2G2A2G2E2D2C4|"G"D2E2G2E2D2C2D4|"Am"E2G2A2c2B2A2G4|"F"F2E2D2E2G2E2C4|'

const text = (page: Page) => page.locator('#se-text')
const sheet = (page: Page) => page.evaluate(() => (window as unknown as { __tracksSheet: { state: string; peak: number; renders: number } }).__tracksSheet)

/** YuE2's own score check (vendored from the YuE repository): 0 = it takes the score */
function yue2Inspect(file: string): number | null {
  return spawnSync('python3', ['-I', 'e2e/yue2/abc_tools.py', 'inspect', file], { encoding: 'utf8' }).status
}

async function openEditor(page: Page): Promise<void> {
  await page.goto('/sheet-music')
  await expect(page.locator('.se-view svg')).toBeVisible()
}

async function openScore(page: Page): Promise<string> {
  const original = await readFile(SCORE, 'utf8')
  await page.locator('.se-files input[type=file]').setInputFiles(SCORE)
  await expect(text(page)).toHaveValue(original)
  await expect(page.locator('.se-verdict')).toHaveText('YuE2 can read this score: 8 bars, 56 notes, 8 chord symbols.')
  return original
}

/** abcjs picks the note nearest the pointer, so a staff line drawn over the note head doesn't matter */
async function pickFirstNote(page: Page): Promise<void> {
  await page.locator('.se-view .abcjs-note.abcjs-v0.abcjs-l0.abcjs-m0.abcjs-n0').click({ force: true })
}

test('edits a YuE2 score note by note, checks it, and saves exactly that change', async ({ page, diag }) => {
  await openEditor(page)
  const original = await openScore(page)
  await expect(page.locator('.se-name')).toHaveText('score.abc · C major · 4/4 · 88 BPM')

  // pick a note in the sheet music: the text marks the same note
  await pickFirstNote(page)
  await expect(page.locator('.se-picked')).toHaveText('Vocal part · bar 1 · E4 · eighth note · chord C')
  await expect(page.locator('.se-mirror mark')).toHaveText('E2')
  await expect(page.getByLabel('Chord symbol')).toHaveValue('C')

  // raise it a step with the note buttons
  await page.getByRole('toolbar', { name: 'Note tools' }).getByRole('button', { name: 'Up', exact: true }).click()
  await expect(page.locator('.se-picked')).toHaveText('Vocal part · bar 1 · F4 · eighth note · chord C')
  await expect(page.locator('.se-mirror mark')).toHaveText('F2')
  await expect(page.locator('.se-view .abcjs-note_selected').first()).toBeAttached()

  // the keys move along the part
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.se-picked')).toHaveText('Vocal part · bar 1 · G4 · eighth note')
  await page.keyboard.press('ArrowLeft')

  // save: the file differs from the original by that one note, and YuE2 takes it
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save .abc' }).click()])
  expect(download.suggestedFilename()).toBe('score.abc')
  const path = (await download.path())!
  const saved = await readFile(path, 'utf8')
  const before = original.split('\n'), after = saved.split('\n')
  expect(after.length).toBe(before.length)
  const changed = before.flatMap((line, i) => (line === after[i] ? [] : [[line, after[i]]]))
  expect(changed).toEqual([[FIRST_LINE, RAISED_LINE]])
  expect(yue2Inspect(path)).toBe(0)
  await expect(page.locator('.se-picked')).toHaveText('Saved score.abc.')

  // typing redraws the sheet music, and the check finds a bar that's too long
  const renders = (await sheet(page)).renders
  const broken = saved.replace('"Am"E2G2A2c2B2A2G4|', '"Am"E2G2A2c2B2A2G4A2|')
  await text(page).fill(broken)
  await expect(page.locator('.se-verdict')).toHaveText("1 problem. YuE2 won't take this score until it's fixed. You can still save it.")
  await expect(page.locator('.se-problems button')).toHaveText(['Bar 3 of the Vocal part is longer than 4/4 (it adds up to 4½ beats; the bar holds 4).'])
  await expect(page.locator('.se-mirror .se-bad')).toHaveText('"Am"E2G2A2c2B2A2G4A2')
  await expect.poll(async () => (await sheet(page)).renders).toBeGreaterThan(renders)
  // the note buttons wait until the score is fixed; saving still works, with a warning
  await pickFirstNote(page)
  await page.getByRole('toolbar', { name: 'Note tools' }).getByRole('button', { name: 'Down', exact: true }).click()
  await expect(page.locator('.se-picked')).toContainText('The note buttons work once the score has no problems')
  const [warned] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save .abc' }).click()])
  expect(await readFile((await warned.path())!, 'utf8')).toBe(broken)
  await expect(page.locator('.se-picked')).toContainText("with 1 problem left: YuE2 won't take it until it's fixed")

  // the editor's own undo steps back through typing and button edits
  await text(page).focus()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(text(page)).toHaveValue(saved)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(text(page)).toHaveValue(original)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(text(page)).toHaveValue(saved)

  // it keeps the score for the next visit
  await page.reload()
  await expect(text(page)).toHaveValue(saved)
  expect(diag.pageErrors).toEqual([])
})

test('plays the score with a moving cursor, and starts new scores from a template', async ({ page, diag }) => {
  await openEditor(page)
  await openScore(page)
  const cursorX = () => page.locator('.se-view .sheet-cursor').getAttribute('x1')
  const startX = await cursorX()
  const play = page.locator('.se-files [data-act=play]')
  await play.click()
  // the audio is rendered offline first, as in the share player: slower when several browsers render at once
  await expect(play).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 })
  await expect(play).toHaveText('Stop')
  await expect.poll(async () => (await sheet(page)).peak).toBeGreaterThan(0.02)
  await expect.poll(cursorX).not.toBe(startX)
  await expect(page.locator('.se-view .sheet-now').first()).toBeAttached()
  await play.click()
  await expect(play).toHaveAttribute('aria-pressed', 'false')

  await page.getByRole('button', { name: 'New score' }).click()
  const dialog = page.getByRole('dialog', { name: 'New score' })
  await dialog.getByLabel('Tempo (BPM)').fill('120')
  await dialog.getByLabel('Time signature').selectOption('3/4')
  await dialog.getByLabel('Key').selectOption({ label: 'Eb major' })
  await dialog.getByLabel('Bars').fill('6')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog).toBeHidden()
  await expect(text(page)).toHaveValue(/^X:1\nT:\nM:3\/4\nL:1\/16\nQ:1\/4=120\n[\s\S]*\nK:Eb\n/)
  await expect(page.locator('.se-verdict')).toHaveText('YuE2 can read this score: 6 bars, 0 notes, 0 chord symbols.')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(text(page)).toHaveValue(await readFile(SCORE, 'utf8'))

  // print: only the notation goes on the page
  await page.evaluate(() => { const w = window as unknown as { printed: number }; w.printed = 0; window.print = () => { w.printed++ } })
  await page.getByRole('button', { name: 'Print / PDF' }).click()
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.se-tools')).toBeHidden()
  await expect(text(page)).toBeHidden()
  await expect(page.locator('.se-view svg')).toBeVisible()
  await page.emulateMedia({ media: 'screen' })
  expect(diag.pageErrors).toEqual([])
})

test('sends a score to the studio as tracks, and a studio track back to the editor', async ({ page, diag }) => {
  await openEditor(page)
  const original = await openScore(page)
  await page.getByRole('button', { name: 'Send to studio' }).click()
  await page.waitForURL(url => url.pathname === '/studio' && !url.search)
  await waitForStudio(page)
  await expect.poll(() => songState(page)).toMatchObject({ name: 'score', bpm: 88, tracks: ['Vocal Melody', 'Chords'], noteCount: 80 })
  await expect(page.locator('.toast')).toContainText('Opened score: 56 notes, 8 chords.')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(async () => (await transportState(page)).beat).toBeGreaterThan(0.5)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()

  await page.getByRole('button', { name: 'Sheet music', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Sheet music' })
  await dialog.getByLabel('Melody from').selectOption({ label: 'Vocal Melody' })
  await dialog.getByLabel('Chords from').selectOption({ label: 'Chords' })
  await dialog.getByRole('button', { name: 'Edit as sheet music' }).click()
  await page.waitForURL(url => url.pathname === '/sheet-music' && !url.search)
  // the studio writes the same score back, without the comment lines
  await expect(text(page)).toHaveValue(original.split('\n').filter(l => !l.startsWith('% ')).join('\n'))
  await expect(page.locator('.se-picked')).toHaveText('Opened score from the studio. Undo brings back the score you had here.')
  await expect(page.locator('.se-verdict')).toHaveText('YuE2 can read this score: 8 bars, 56 notes, 8 chord symbols.')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(text(page)).toHaveValue(original)
  expect(diag.pageErrors).toEqual([])
})

test('opens a two-part MIDI file as a YuE2 score, and says plainly when a file has only drums', async ({ page, diag }) => {
  await openEditor(page)
  // parts named as YuE2 song pages name them
  await page.locator('.se-files input[type=file]').setInputFiles('e2e/yue2/two-part.mid')
  await expect(page.locator('.se-picked')).toHaveText('Opened two-part.mid as sheet music. Vocal part from “Vocal Melody”. Ins part from “Ins Melody”. Undo brings back the score you had.')
  await expect(page.locator('.se-verdict')).toHaveText('YuE2 can read this score: 8 bars, 38 notes, 0 chord symbols.')
  await expect(page.locator('.se-name')).toHaveText('two-part.abc · G major · 4/4 · 88 BPM')
  await expect(text(page)).toHaveValue(/^X:1\nT:\nM:4\/4\nL:1\/16\nQ:1\/4=88\n/)
  // both staves are drawn, each with its notes
  await expect(page.locator('.se-view .abcjs-note.abcjs-v0')).toHaveCount(25)
  await expect(page.locator('.se-view .abcjs-note.abcjs-v1')).toHaveCount(13)

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save .abc' }).click()])
  expect(download.suggestedFilename()).toBe('two-part.abc')
  const saved = await download.path()
  expect(yue2Inspect(saved!)).toBe(0)

  // a drums-only file leaves the score as it was
  const before = await text(page).inputValue()
  const drums = smf([{ name: 'Beat', channel: 9, notes: [[0, 0.25, 36], [1, 0.25, 38]] }])
  await page.locator('.se-files input[type=file]').setInputFiles({ name: 'beat.mid', mimeType: 'audio/midi', buffer: Buffer.from(drums) })
  await expect(page.locator('.se-picked')).toHaveText('beat.mid: That MIDI file only has drums. Sheet music needs a melody, so there is nothing to show.')
  await expect(text(page)).toHaveValue(before)
  expect(diag.pageErrors).toEqual([])
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

  test('views, edits, plays and saves a score', async ({ page, diag }, testInfo) => {
    await openEditor(page)
    await openScore(page)
    // the studio needs a bigger screen, so the editor says so instead of sending
    await expect(page.getByRole('button', { name: 'Send to studio' })).toBeHidden()
    await expect(page.locator('.se-phone-note')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

    await pickFirstNote(page)
    await page.getByRole('button', { name: 'Up', exact: true }).tap()
    await expect(text(page)).toHaveValue(new RegExp(RAISED_LINE.replace(/[|]/g, '\\|')))
    const renders = (await sheet(page)).renders
    await text(page).fill((await text(page).inputValue()).replace('"F"F2E2D2E2G2E2C4|\nV: Ins', '"F"F2E2D2E2G2E2C2C2|\nV: Ins'))
    await expect.poll(async () => (await sheet(page)).renders).toBeGreaterThan(renders)
    await expect(page.locator('.se-verdict')).toHaveText('YuE2 can read this score: 8 bars, 57 notes, 8 chord symbols.')
    await testInfo.attach('phone', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    const play = page.locator('.se-files [data-act=play]')
    await play.tap()
    await expect.poll(async () => (await sheet(page)).state, { timeout: 30_000 }).toBe('playing')
    await play.tap()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save .abc' }).tap()])
    expect(yue2Inspect((await download.path())!)).toBe(0)
    expect(diag.pageErrors).toEqual([])
  })
})
