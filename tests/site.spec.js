const { test, expect } = require('@playwright/test');
const catalogue = require('../data/vinyls.json');

test('catalogue loads without errors and uses the responsive grid', async ({ page }) => {
  const errors = [];
  let catalogueRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().endsWith('/data/vinyls.json')) catalogueRequests += 1;
  });

  await page.goto('/');
  await expect(page.locator('#resultCount')).toHaveText('2.357 plader');
  await expect(page.locator('.vinyl-card')).toHaveCount(48);
  await expect(page.locator('.discount-banner')).toContainText('15% rabat på alle plader');
  await expect(page.locator('.vinyl-card').first().locator('.card-price-label')).toHaveText('Efter 15% rabat');
  await expect(page.locator('.card-shelf')).toHaveCount(0);
  await expect(page.locator('.vinyl-card').first().locator('.card-details')).toBeHidden();
  await page.getByRole('button', { name: 'Detaljeret visning' }).click();
  await expect(page.getByRole('button', { name: 'Detaljeret visning' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.vinyl-card').first().locator('.card-details')).toBeVisible();
  await expect(page.locator('.vinyl-card').first().locator('.card-details')).toContainText('Discogs-pris');
  await expect(page.locator('.vinyl-card').first().locator('.card-details')).toContainText('Hylde');
  await expect(page.locator('#genreCount')).toHaveText('15');
  await expect(page.getByRole('option', { name: 'Folk, World, & Country' })).toHaveCount(1);
  await expect(page.getByRole('option', { name: '& Country', exact: true })).toHaveCount(0);

  const layout = await page.locator('#vinylGrid').evaluate(element => ({
    display: getComputedStyle(element).display,
    columns: getComputedStyle(element).gridTemplateColumns.split(' ').length
  }));
  expect(layout.display).toBe('grid');
  expect(layout.columns).toBeGreaterThan(1);
  await expect(page.locator('.catalogue-tools')).toHaveCSS('position', 'sticky');
  await expect(page.locator('.catalogue-tools')).toHaveCSS('top', '64px');
  expect(catalogueRequests).toBe(1);
  expect(errors).toEqual([]);
});

test('reserved and sold records are hidden from the catalogue', async ({ page }) => {
  const catalogueWithStatuses = catalogue.map((vinyl, index) => {
    if (index === 0) return { ...vinyl, status: 'reserved' };
    if (index === 1) return { ...vinyl, status: 'sold' };
    return vinyl;
  });
  await page.route('**/data/vinyls.json', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(catalogueWithStatuses)
  }));

  await page.goto('/');
  await expect(page.locator('#resultCount')).toHaveText('2.355 plader');
  await expect(page.locator('.vinyl-card[data-id="1"]')).toHaveCount(0);
  await expect(page.locator('.vinyl-card[data-id="2"]')).toHaveCount(0);
});

test('mobile layout exposes the catalogue action without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const mobileLayout = await page.evaluate(() => {
    const cta = document.querySelector('.hero-cta').getBoundingClientRect();
    const grid = document.querySelector('#vinylGrid');
    return {
      ctaBottom: cta.bottom,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      gridDisplay: getComputedStyle(grid).display,
      gridColumns: getComputedStyle(grid).gridTemplateColumns.split(' ').length
    };
  });

  expect(mobileLayout.ctaBottom).toBeLessThan(844);
  expect(mobileLayout.horizontalOverflow).toBe(false);
  expect(mobileLayout.gridDisplay).toBe('grid');
  expect(mobileLayout.gridColumns).toBe(1);

  await expect(page.locator('#filterRow')).toBeHidden();
  await page.getByRole('button', { name: 'Filtre', exact: true }).click();
  await expect(page.locator('#filterRow')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filtre', exact: true })).toHaveAttribute('aria-expanded', 'true');
});

test('search, sorting, reset and pagination work', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Søg i katalog').fill('ABBA');
  await expect(page.locator('#resultCount')).not.toHaveText('2.357 plader');
  await expect(page.locator('.vinyl-card')).toHaveCount(10);

  await page.getByRole('button', { name: 'Nulstil filtre' }).click();
  await expect(page.locator('#resultCount')).toHaveText('2.357 plader');

  const catNoCounts = catalogue.reduce((counts, vinyl) => {
    if (vinyl.catNo) counts[vinyl.catNo] = (counts[vinyl.catNo] || 0) + 1;
    return counts;
  }, {});
  const uniqueCatNo = catalogue.find(vinyl => vinyl.catNo && catNoCounts[vinyl.catNo] === 1).catNo;
  await page.getByLabel('Søg i katalog').fill(uniqueCatNo);
  await expect(page.locator('#resultCount')).toHaveText('1 plade');
  await page.getByRole('button', { name: 'Nulstil filtre' }).click();

  await page.getByLabel('Sortering').selectOption('price-desc');
  const firstTwoPrices = await page.locator('.vinyl-card').evaluateAll(cards =>
    cards.slice(0, 2).map(card => Number(card.dataset.priceOre))
  );
  expect(firstTwoPrices[0]).toBeGreaterThanOrEqual(firstTwoPrices[1]);

  await page.getByRole('button', { name: /Vis flere/ }).click();
  await expect(page.locator('.vinyl-card')).toHaveCount(96);
});

test('basket and checkout preserve the order until explicit clearing', async ({ page }) => {
  await page.goto('/');
  await page.locator('.vinyl-card').first().getByRole('button', { name: 'Læg i kurv' }).click();
  await expect(page.locator('#basketCount')).toHaveText('1');

  await page.getByRole('button', { name: 'Åbn kurv' }).click();
  await expect(page.getByRole('button', { name: 'Luk kurv' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Gå til bestilling' })).toBeFocused();
  await page.getByRole('button', { name: 'Gå til bestilling' }).click();
  await expect(page.getByRole('button', { name: 'Luk bestilling' })).toBeFocused();
  await expect(page.locator('#checkoutSummary')).toHaveText(/1 plade · Total \d+ kr/);

  await page.getByLabel('Navn *').fill('Test Køber');
  await page.getByLabel('Email *').fill('ikke-en-email');
  await page.getByLabel('Mobil *').fill('123');
  await page.getByRole('button', { name: 'Generér bestilling' }).click();
  await expect(page.locator('#errorEmail')).toHaveText('Skriv en gyldig emailadresse.');
  await expect(page.locator('#errorMobil')).toHaveText('Skriv et gyldigt mobilnummer.');

  await page.getByLabel('Email *').fill('test@example.com');
  await page.getByLabel('Mobil *').fill('+45 12 34 56 78');
  await page.getByLabel('Besked (valgfri)').fill('Hvad er standen?');
  await page.getByRole('button', { name: 'Generér bestilling' }).click();

  await expect(page.locator('#orderText')).toHaveValue(/#\d+.*Kat\.nr\./s);
  await expect(page.locator('#orderText')).toHaveValue(/Hylde/);
  await expect(page.locator('#orderText')).toHaveValue(/Besked:\nHvad er standen\?/);
  await expect(page.locator('#basketCount')).toHaveText('1');

  await page.getByRole('button', { name: 'Jeg har sendt – ryd kurven' }).click();
  await expect(page.locator('#basketCount')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Åbn kurv' })).toBeFocused();
});

test('desktop checkout keeps the clipboard-only order action', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.clipboard.writeText = text => {
      window.copiedOrder = text;
      return Promise.resolve();
    };
    navigator.share = data => {
      window.sharedOrder = data;
      return Promise.resolve();
    };
  });
  await page.goto('/');
  await page.locator('.vinyl-card').first().getByRole('button', { name: 'Læg i kurv' }).click();
  await page.getByRole('button', { name: 'Åbn kurv' }).click();
  await page.getByRole('button', { name: 'Gå til bestilling' }).click();
  await page.getByLabel('Navn *').fill('Test Køber');
  await page.getByLabel('Email *').fill('test@example.com');
  await page.getByLabel('Mobil *').fill('+45 12 34 56 78');
  await page.getByRole('button', { name: 'Generér bestilling' }).click();
  const orderText = await page.locator('#orderText').inputValue();

  await expect(page.getByRole('button', { name: 'Kopiér til udklipsholder' })).toBeVisible();
  await expect(page.locator('#orderInstructionsPrefix')).toHaveText('Kopiér teksten og send den som en email til ');

  await page.getByRole('button', { name: 'Kopiér til udklipsholder' }).click();

  await expect.poll(() => page.evaluate(() => window.copiedOrder)).toBe(orderText);
  await expect.poll(() => page.evaluate(() => window.sharedOrder || null)).toBe(null);
});

test('mobile checkout sends the plain-text order and falls back to copying', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.clipboard.writeText = text => {
      window.copiedOrder = text;
      return Promise.resolve();
    };
    navigator.canShare = () => true;
    navigator.share = data => {
      if (window.failShare) return Promise.reject(new DOMException('Unavailable', 'NotAllowedError'));
      window.sharedOrder = data;
      return Promise.resolve();
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.vinyl-card').first().getByRole('button', { name: 'Læg i kurv' }).click();
  await page.getByRole('button', { name: 'Åbn kurv' }).click();
  await page.getByRole('button', { name: 'Gå til bestilling' }).click();
  await page.getByLabel('Navn *').fill('Test Køber');
  await page.getByLabel('Email *').fill('test@example.com');
  await page.getByLabel('Mobil *').fill('+45 12 34 56 78');
  await page.getByRole('button', { name: 'Generér bestilling' }).click();
  const orderText = await page.locator('#orderText').inputValue();

  await expect(page.getByRole('button', { name: 'Send bestillingen' })).toBeVisible();
  await expect(page.locator('#orderInstructionsPrefix')).toHaveText('Send bestillingen direkte fra din telefon, fx som email, til ');
  await page.getByRole('button', { name: 'Send bestillingen' }).click();

  await expect.poll(() => page.evaluate(() => window.sharedOrder)).toEqual({
    title: 'Ny bestilling',
    text: orderText
  });

  await page.evaluate(() => { window.failShare = true; });
  await page.getByRole('button', { name: 'Send bestillingen' }).click();
  await expect.poll(() => page.evaluate(() => window.copiedOrder)).toBe(orderText);
  await expect(page.locator('#copyConfirm')).toHaveText('Kunne ikke åbne sendemulighederne – teksten er kopieret i stedet.');
});

test('a catalogue card can add and remove a record from the basket', async ({ page }) => {
  await page.goto('/');
  const firstCard = page.locator('.vinyl-card').first();

  await firstCard.getByRole('button', { name: 'Læg i kurv' }).click();
  await expect(page.locator('#basketCount')).toHaveText('1');
  await expect(firstCard.getByRole('button', { name: 'Fjern fra kurv' })).toHaveText('I kurven ✓');

  await firstCard.getByRole('button', { name: 'Fjern fra kurv' }).click();
  await expect(page.locator('#basketCount')).toHaveText('0');
  await expect(firstCard.getByRole('button', { name: 'Læg i kurv' })).toBeVisible();
});

test('volume discount activates from five valid basket items', async ({ page }) => {
  await page.goto('/');
  for (let index = 0; index < 5; index += 1) {
    await page.locator('button[data-action="add"]:not(:disabled)').first().click();
  }

  await expect(page.locator('#basketCount')).toHaveText('5');
  await page.getByRole('button', { name: 'Åbn kurv' }).click();
  await expect(page.getByText('10% mængderabat aktiveret')).toBeVisible();
  await expect(page.locator('.price-row.total')).toContainText('Total');
});

test('unavailable IDs are removed from a saved basket', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pladesamling_basket', JSON.stringify([1, 999999, 1]));
  });
  await page.goto('/');
  await expect(page.locator('#basketCount')).toHaveText('1');

  const storedBasket = await page.evaluate(() => JSON.parse(localStorage.getItem('pladesamling_basket')));
  expect(storedBasket).toEqual([1]);
});
