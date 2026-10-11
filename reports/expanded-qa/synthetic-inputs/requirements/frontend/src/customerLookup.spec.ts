import {test, expect} from '@playwright/test';

// Illustrative browser-test source; no fixture application, runner, or execution
// record is provided. The requirements reviewer only reads this file as text.
test('renders customer display name', async ({page}) => {
  await page.goto('/customers');
  await expect(page.getByLabel('Customer result')).toHaveText('Ada Example');
});
