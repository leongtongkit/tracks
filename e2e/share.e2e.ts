import { devices, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { expect, openSongsPanel, openStudio, songState, test, TRACKS_URL, waitForStudio } from './fixtures'

async function fresh(browser: Browser, phone = false): Promise<BrowserContext> {
  const context = await browser.newContext(phone ? { ...devices['iPhone 13'] } : {})
  await context.addInitScript(() => {
    try {
      localStorage.setItem('jfound_cookie_consent', JSON.stringify({ v: 2, essential: true, analytics: false }))
      localStorage.setItem('tracks.tip.v1', 'dismissed')
    } catch { /* storage unavailable */ }
  })
  await context.route(url => /^https?:$/.test(url.protocol) && url.origin !== new URL(TRACKS_URL).origin, route => route.fulfill({ status: 200, body: '' }))
  return context
}

async function makeSong(page: Page, name: string): Promise<number> {
  await openStudio(page)
  const panel = await openSongsPanel(page)
  await panel.getByRole('button', { name: 'New empty song', exact: true }).click()
  const lane = await page.locator('.lane').nth(1).boundingBox()
  if (!lane) throw new Error('lane not visible')
  await page.mouse.dblclick(lane.x + 60, lane.y + lane.height / 2)
  const roll = await page.locator('.proll-scroll').boundingBox()
  if (!roll) throw new Error('piano roll not visible')
  await page.mouse.click(roll.x + 200, roll.y + roll.height / 2)
  const songs = await openSongsPanel(page)
  await songs.getByRole('textbox', { name: 'Song name' }).fill(name)
  await songs.getByRole('button', { name: 'Close', exact: true }).first().click()
  return (await songState(page)).noteCount
}

// a different site that embeds the player (served by the test itself)
const HOST_PAGE = 'https://embed-host.test/'

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __tracksPlayer?: { state: string } }).__tracksPlayer?.state === 'ready', null, { timeout: 30000 })
}

test('share, play, remix, phone, and embedded player', async ({ page, browser, context }) => {
  const countA = await makeSong(page, 'Shared song')
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Share song' })
  const link = await dialog.getByRole('textbox', { name: 'Link', exact: true }).inputValue()
  const embed = await dialog.getByRole('textbox', { name: 'Embed code' }).inputValue()
  const other = await fresh(browser)
  const phone = await fresh(browser, true)
  try {
    const recipient = await other.newPage()
    const mine = await makeSong(recipient, 'Mine')
    await recipient.goto(link)
    await expect(recipient.getByRole('heading', { name: 'Shared song' })).toBeVisible()
    await ready(recipient)
    expect(await recipient.evaluate(() => (window as unknown as { __tracksPlayer: { peak: number } }).__tracksPlayer.peak)).toBeGreaterThan(0.01)
    await recipient.getByRole('button', { name: 'Play', exact: true }).click()
    await expect.poll(() => recipient.evaluate(() => (window as unknown as { __tracksPlayer: { state: string } }).__tracksPlayer.state)).toBe('playing')
    await recipient.getByRole('button', { name: 'Stop', exact: true }).click()
    await recipient.getByRole('button', { name: 'Remix this' }).click()
    await recipient.getByRole('button', { name: 'Start remix' }).click()
    await waitForStudio(recipient)
    expect(await songState(recipient)).toMatchObject({ name: 'Shared song', noteCount: countA })
    expect(new URL(recipient.url()).hash).toBe('')
    const songs = await openSongsPanel(recipient)
    await expect(songs.locator('.songs-title')).toContainText(['Shared song', 'Mine'])
    await songs.locator('.songs-row').filter({ hasText: 'Mine' }).getByRole('button', { name: 'Open', exact: true }).click()
    const confirm = recipient.getByRole('button', { name: 'Open song', exact: true })
    if (await confirm.isVisible()) await confirm.click()
    expect(await songState(recipient)).toMatchObject({ name: 'Mine', noteCount: mine })

    const mobile = await phone.newPage()
    const bootRequests: string[] = []
    mobile.on('request', req => { if (/\/assets\/boot-[^/]+\.js/.test(req.url())) bootRequests.push(req.url()) })
    await mobile.goto(link)
    await expect(mobile.getByText('Open this link on a computer to remix it.')).toBeVisible()
    await expect(mobile.getByRole('button', { name: 'Remix this' })).toHaveCount(0)
    await ready(mobile)
    await mobile.getByRole('button', { name: 'Play', exact: true }).click()
    await expect.poll(() => mobile.evaluate(() => (window as unknown as { __tracksPlayer: { state: string } }).__tracksPlayer.state)).toBe('playing')
    expect(bootRequests).toEqual([])

    const embedPage = await context.newPage()
    const requests: string[] = []
    embedPage.on('request', req => requests.push(req.url()))
    await context.route(HOST_PAGE, route => route.fulfill({ status: 200, contentType: 'text/html', body: embed }))
    const responsePromise = embedPage.waitForResponse(response => response.url().startsWith(TRACKS_URL + '/embed'))
    await embedPage.goto(HOST_PAGE)
    const response = await responsePromise
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow')
    expect(response.headers()['content-security-policy']).toBe('frame-ancestors *')
    const frame = embedPage.frameLocator('iframe')
    await expect(frame.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 30000 })
    await frame.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(frame.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    // the embedded player never asks about privacy; it only honours an earlier choice
    await expect(frame.locator('#consent-mod')).toHaveCount(0)
    expect(requests.filter(url => /\/ads\.js|googlesyndication/.test(url))).toEqual([])
    const studio = await context.request.get(TRACKS_URL + '/studio')
    expect(studio.headers()['content-security-policy']).toBe("frame-ancestors 'self'")
  } finally {
    await other.close()
    await phone.close()
  }
})

test('invalid song link shows an error', async ({ page, diag }) => {
  await page.goto(TRACKS_URL + '/studio#s=1.xyz')
  await expect(page.getByText("This link doesn't contain a song we can open.")).toBeVisible()
  expect(diag.consoleErrors).toEqual([])
  expect(diag.pageErrors).toEqual([])
})
