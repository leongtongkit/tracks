import { expect, openStudio, test } from './fixtures'

test('studio loads and boots with zero console and page errors', async ({ page, diag }) => {
  await openStudio(page)
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Songs', exact: true })).toBeVisible()
  expect(diag.pageErrors).toEqual([])
  expect(diag.consoleErrors).toEqual([])
})
