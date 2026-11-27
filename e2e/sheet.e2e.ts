import type { Page } from '@playwright/test'
import { expect, openSongsPanel, openStudio, songState, test, transportState } from './fixtures'

async function startSong(page: Page, label: string): Promise<void> {
  const songs = await openSongsPanel(page)
  await songs.getByRole('button', { name: label, exact: true }).click()
  await expect(songs).toBeHidden()
}

async function openSheet(page: Page) {
  await page.getByRole('button', { name: 'Sheet music', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Sheet music' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('shows the selected clip as sheet music, plays along and prints', async ({ page, diag }) => {
  await openStudio(page)
  await startSong(page, 'Rock')
  // the selected clip's track is what the sheet shows first (Bass, not the Lead it would pick by name)
  await page.locator('.lane').nth(1).locator('.clip').first().click()
  const selected = () => page.evaluate(() => { const app = (window as any).__tracksApp; return app.project.tracks.find((t: { id: string }) => t.id === app.selectedClip?.trackId)?.name })
  expect(await selected()).toBe('Bass')
  const dialog = await openSheet(page)
  await expect(dialog.getByLabel('Melody from').locator('option:checked')).toHaveText('Bass')
  const score = dialog.locator('.sheet-score')
  await expect(score).toHaveAttribute('aria-label', 'Sheet music for Bass')

  // keys typed in the dialog never edit the song behind it
  const notes = (await songState(page)).noteCount
  await page.keyboard.press('Backspace')
  await page.keyboard.press('ControlOrMeta+z')
  expect((await songState(page)).noteCount).toBe(notes)
  expect(await selected()).toBe('Bass')

  await dialog.getByLabel('Melody from').selectOption({ label: 'Lead' })
  await expect(score).toHaveAttribute('aria-label', 'Sheet music for Lead')
  await expect(score.locator('svg .abcjs-note').first()).toBeVisible()
  expect(await score.locator('svg .abcjs-note').count()).toBeGreaterThanOrEqual(15)
  await expect(score.locator('svg')).toContainText('Rock sketch')
  await expect(dialog.locator('.sheet-meta')).toHaveText('E minor · 120 BPM · 4/4 · Lead')

  // play: the button follows the transport and the cursor walks along the notes
  const cursorX = () => score.locator('.sheet-cursor').getAttribute('x1')
  const startX = await cursorX()
  await dialog.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await expect.poll(async () => (await transportState(page)).beat).toBeGreaterThan(1)
  await expect.poll(cursorX).not.toBe(startX)
  await expect(score.locator('.sheet-now').first()).toBeAttached()
  await dialog.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Play', exact: true })).toBeVisible()

  // print: the browser's print dialog, with only the title line and the notes on the page
  await page.evaluate(() => { const w = window as unknown as { printed: number }; w.printed = 0; window.print = () => { w.printed++ } })
  await dialog.getByRole('button', { name: 'Print / Save as PDF' }).click()
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.transport-bar')).toBeHidden()
  await expect(dialog.getByRole('button', { name: 'Download .abc' })).toBeHidden()
  await expect(score.locator('svg')).toBeVisible()
  await expect(dialog.locator('.sheet-meta')).toBeVisible()
  // the page is the notation, edge to edge, not the on-screen dialog shrunk to fit
  expect(await score.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(page.viewportSize()!.width * 0.9)
  await page.emulateMedia({ media: 'screen' })

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.locator('body')).not.toHaveClass(/sheet-open/)
  expect(diag.pageErrors).toEqual([])
})

test('draws the demo and every starter song', async ({ page, diag }) => {
  await openStudio(page) // a first visit opens the demo song
  const songs: [string | null, string][] = [[null, 'First Light (demo)'], ['Lo-fi', 'Lo-fi sketch'], ['House', 'House sketch'], ['Hip-hop', 'Hip-hop sketch'], ['Rock', 'Rock sketch'], ['Game music', 'Game music sketch']]
  for (const [label, title] of songs) {
    if (label) await startSong(page, label)
    const dialog = await openSheet(page)
    await expect(dialog.locator('.sheet-score svg .abcjs-note').first()).toBeVisible()
    await expect(dialog.locator('.sheet-score svg')).toContainText(title)
    await expect(dialog.locator('.sheet-score')).not.toContainText('Could not')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
  }
  expect(diag.pageErrors).toEqual([])
})

test('an empty song says what to do instead of drawing a staff', async ({ page }) => {
  await openStudio(page)
  await startSong(page, 'New empty song')
  const dialog = await openSheet(page)
  await expect(dialog.locator('.sheet-score')).toHaveText('Add a track with notes to see it here as sheet music.')
  await expect(dialog.getByRole('button', { name: 'Print / Save as PDF' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Download .abc' })).toBeDisabled()
})
