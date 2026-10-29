import {expect} from '@playwright/test';

export async function openWatchlist(page) {
  await expect(page.locator('.app-shell')).toBeVisible();
  const link=page.getByRole('navigation',{name:'Settings sections'}).getByRole('link',{name:'Watchlist',exact:true});
  if (!await link.count()) {
    const more=page.getByRole('button',{name:'More navigation',exact:true});
    if (await more.isVisible()) await more.click();
    await page.locator('.sidebar').getByRole('button',{name:'Settings',exact:true}).click();
  }
  await link.click();
  await expect(link).toHaveAttribute('aria-current','page');
  await expect(page.getByRole('heading',{name:'Watchlist radar',exact:true})).toBeVisible();
}
