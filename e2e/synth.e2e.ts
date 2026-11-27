import { expect, test, SYNTH_URL } from './fixtures'

test('synth home loads without errors and the keyboard responds', async ({ page, diag }) => {
  const response = await page.goto(SYNTH_URL + '/')
  expect(response?.status()).toBe(200)

  const whiteKeys = page.locator('.key-w')
  await expect(whiteKeys.first()).toBeVisible()
  expect(await whiteKeys.count()).toBeGreaterThan(7)

  // unlock audio the way a visitor does, then play a key with the mouse
  const scrim = page.locator('#scrim')
  if (await scrim.isVisible()) {
    await scrim.click()
    await expect(scrim).toBeHidden()
  }
  await whiteKeys.nth(2).click()
  await page.keyboard.press('a')
  await page.keyboard.press('s')

  // still alive and well after interaction
  await expect(whiteKeys.first()).toBeVisible()
  expect(diag.pageErrors).toEqual([])
  expect(diag.consoleErrors).toEqual([])
})
