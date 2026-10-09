import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort())
})

async function settings(page) {
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
  await expect(page.getByText('✓ Geräteübergreifend synchronisiert')).toBeVisible()
}

test('settings persist after reload and reopening the root URL', async ({ page }) => {
  await page.goto('/')
  await settings(page)
  const profile = new URL(page.url()).hash
  await page.getByRole('checkbox').nth(2).check()
  await page.getByRole('spinbutton', { name: 'Umkreis in Kilometern' }).fill('3.5')
  await expect(page.getByRole('button', { name: 'Fertig', exact: true })).toBeEnabled()
  await page.reload()
  await settings(page)
  await expect(page.getByRole('checkbox').nth(2)).toBeChecked()
  await expect(page.getByRole('spinbutton')).toHaveValue('3.5')
  await page.goto('/')
  await settings(page)
  expect(new URL(page.url()).hash).toBe(profile)
  await expect(page.getByRole('checkbox').nth(2)).toBeChecked()
  await expect(page.getByRole('spinbutton')).toHaveValue('3.5')
})

test('changes during an ongoing save are serialized and finish waits for confirmation', async ({ page }) => {
  await page.goto('/')
  await settings(page)
  let writes = 0
  await page.route('**/api/rthtrack/settings', async (route) => {
    if (route.request().method() === 'PUT') {
      writes++
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    await route.continue()
  })
  await page.getByRole('checkbox').nth(2).check()
  await expect(page.getByRole('button', { name: 'Fertig', exact: true })).toBeDisabled()
  await page.getByRole('spinbutton').fill('7')
  await expect(page.getByRole('button', { name: 'Fertig', exact: true })).toBeEnabled()
  expect(writes).toBe(2)
  await page.reload()
  await settings(page)
  await expect(page.getByRole('checkbox').nth(2)).toBeChecked()
  await expect(page.getByRole('spinbutton')).toHaveValue('7')
})

test('revision conflicts are displayed without silently overwriting another client', async ({ page }) => {
  await page.goto('/')
  await settings(page)
  let writes = 0
  await page.route('**/api/rthtrack/settings', async (route) => {
    if (route.request().method() === 'PUT') {
      writes++
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Auf einem anderen Gerät geändert. Bitte neu laden.' }) })
    } else await route.continue()
  })
  await page.getByRole('checkbox').nth(2).check()
  await expect(page.getByRole('alert')).toContainText('Auf einem anderen Gerät geändert')
  await expect(page.getByRole('button', { name: 'Fertig', exact: true })).toBeDisabled()
  expect(writes).toBe(1)
})

test('live rescue markers display and other helicopters respect the saved filter', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.radar-label strong', { hasText: 'CHX30' })).toBeVisible()
  await expect(page.locator('.is-other-heli')).toHaveCount(0)
  await settings(page)
  await page.getByRole('checkbox').nth(2).check()
  await expect(page.getByRole('button', { name: 'Fertig', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  await expect(page.locator('.is-other-heli')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('.is-other-heli')).toHaveCount(1)
})
