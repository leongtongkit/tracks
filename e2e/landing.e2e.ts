import { expect, test, TRACKS_URL } from './fixtures'

test('landing page loads and its studio link works', async ({ page }) => {
  const response = await page.goto(TRACKS_URL + '/')
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('music studio')

  const cta = page.getByRole('link', { name: /Open the studio/ }).first()
  await expect(cta).toBeVisible()
  await cta.click()
  await expect(page).toHaveURL(/\/studio$/)
  await expect(page.locator('.transport-bar')).toBeVisible()
})
