const { test, expect } = require('@playwright/test');
const catalogue = require('../data/vinyls.json');

const PAGE_SIZE = 48;
const COMBINED_COUNTRY_GENRE = 'Folk, World, & Country';

function getVinylStatus(vinyl) {
  if (!vinyl.status) return vinyl.sold ? 'sold' : 'available';
  return String(vinyl.status).toLowerCase().trim();
}

function getGenres(vinyl) {
  if (!vinyl.genres) return [];

  const token = '__FOLK_WORLD_COUNTRY__';
  return String(vinyl.genres)
    .replaceAll(COMBINED_COUNTRY_GENRE, token)
    .split(',')
    .map(genre => genre.trim().replace(token, COMBINED_COUNTRY_GENRE))
    .filter(Boolean);
}

function formatRecordCount(count) {
  return `${count.toLocaleString('da-DK')} ${count === 1 ? 'plade' : 'plader'}`;
}

const availableCatalogue = catalogue.filter(vinyl => getVinylStatus(vinyl) === 'available');

test('catalogue loads without errors and uses the responsive grid', async ({ page }) => {
  const errors = [];
  let catalogueRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().endsWith('/data/vinyls.json')) catalogueRequests += 1;
  });

  await page.goto('/');
  await expect(page.locator('#resultCount')).toHaveText(formatRecordCount(availableCatalogue.length));
  await expect(page.locator('.vinyl-card')).toHaveCount(Math.min(PAGE_SIZE, availableCatalogue.length));
  await expect(page.locator('.discount-banner')).toContainText('15% rabat på alle plader');
  await expect(page.locator('.vinyl-card').first().locator('.card-price-label')).toHaveText('Efter 15% rabat');
  await expect(page.locator('.card-shelf')).toHaveCount(0);
  await expect(page.locator('.vinyl-card').first().locator('.card-details')).toBeHidden();
  await page.getByRole('button', { name: 'Detaljeret visning' }).click();
  await expect(page.getByRole('button', { name: 'Detaljeret visning' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.vinyl-card').first().locator('.card-details')).toBeVisible();
  await expect(page.locator('.vinyl-card').first().locator('.card-details')).toContainText('Discogs-pris');
  await expect(page.locator('.vinyl-card').first().locator('.card-details')).toContainText('Hylde');
  const genreCount = new Set(availableCatalogue.flatMap(getGenres)).size;
  await expect(page.locator('#genreCount')).toHaveText(String(genreCount));
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
  const unavailableIds = availableCatalogue.slice(0, 2).map(vinyl => vinyl.id);
  const catalogueWithStatuses = catalogue.map(vinyl => {
    const unavailableIndex = unavailableIds.indexOf(vinyl.id);
    if (unavailableIndex === 0) return { ...vinyl, status: 'reserved' };
    if (unavailableIndex === 1) return { ...vinyl, status: 'sold' };
    return vinyl;
  });
  await page.route('**/data/vinyls.json', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(catalogueWithStatuses)
  }));

  await page.goto('/');
  await expect(page.locator('#resultCount')).toHaveText(formatRecordCount(availableCatalogue.length - unavailableIds.length));
  for (const id of unavailableIds) {
    await expect(page.locator(`.vinyl-card[data-id="${id}"]`)).toHaveCount(0);
  }
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

  await page.locator('.vinyl-card').first().getByRole('button', { name: 'Læg i kurv' }).click();
  await page.getByRole('button', { name: 'Åbn kurv' }).click();
  await expect(page.getByRole('button', { name: 'Gå til bestilling' })).toBeVisible();

  const basketViewport = await page.locator('#basketSidebar').evaluate(element => ({
    bottom: element.getBoundingClientRect().bottom,
    viewportHeight: window.visualViewport?.height ?? window.innerHeight
  }));
  expect(basketViewport.bottom).toBeLessThanOrEqual(basketViewport.viewportHeight + 1);
});

test('search, sorting, reset and pagination work', async ({ page }) => {
  const abbaMatches = availableCatalogue.filter(vinyl =>
    [vinyl.artist, vinyl.albumTitle, vinyl.catNo, ...getGenres(vinyl)]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('da-DK')
      .includes('abba')
  );

  await page.goto('/');
  await page.getByLabel('Søg i katalog').fill('ABBA');
  await expect(page.locator('#resultCount')).toHaveText(formatRecordCount(abbaMatches.length));
  await expect(page.locator('.vinyl-card')).toHaveCount(Math.min(PAGE_SIZE, abbaMatches.length));

  await page.getByRole('button', { name: 'Nulstil filtre' }).click();
  await expect(page.locator('#resultCount')).toHaveText(formatRecordCount(availableCatalogue.length));

  const catNoCounts = availableCatalogue.reduce((counts, vinyl) => {
    if (vinyl.catNo) counts[vinyl.catNo] = (counts[vinyl.catNo] || 0) + 1;
    return counts;
  }, {});
  const uniqueCatNo = availableCatalogue.find(vinyl => vinyl.catNo && catNoCounts[vinyl.catNo] === 1).catNo;
  await page.getByLabel('Søg i katalog').fill(uniqueCatNo);
  await expect(page.locator('#resultCount')).toHaveText('1 plade');
  await page.getByRole('button', { name: 'Nulstil filtre' }).click();

  await page.getByLabel('Sortering').selectOption('price-desc');
  const firstTwoPrices = await page.locator('.vinyl-card').evaluateAll(cards =>
    cards.slice(0, 2).map(card => Number(card.dataset.priceOre))
  );
  expect(firstTwoPrices[0]).toBeGreaterThanOrEqual(firstTwoPrices[1]);

  await page.getByRole('button', { name: /Vis flere/ }).click();
  await expect(page.locator('.vinyl-card')).toHaveCount(Math.min(PAGE_SIZE * 2, availableCatalogue.length));
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
});

test('mobile checkout opens a prefilled email and offers copy fallback', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.clipboard.writeText = text => {
      window.copiedOrder = text;
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

  const expectedEmailHref = `mailto:mellemvej12@gmail.com?subject=${encodeURIComponent('Ny bestilling')}&body=${encodeURIComponent(orderText)}`;
  await expect(page.getByRole('link', { name: 'Åbn email med bestillingen' })).toHaveAttribute('href', expectedEmailHref);
  await expect(page.locator('#orderInstructionsPrefix')).toHaveText('Åbn en ny email til ');
  await expect(page.getByRole('button', { name: 'Kopiér teksten i stedet' })).toHaveCSS('margin-top', '10px');
  await page.getByRole('button', { name: 'Kopiér teksten i stedet' }).click();
  await expect.poll(() => page.evaluate(() => window.copiedOrder)).toBe(orderText);
  await expect(page.locator('#copyConfirm')).toHaveText('✓ Kopieret!');
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
  const availableId = Number(availableCatalogue[0].id);
  await page.addInitScript(id => {
    localStorage.setItem('pladesamling_basket', JSON.stringify([id, 999999, id]));
  }, availableId);
  await page.goto('/');
  await expect(page.locator('#basketCount')).toHaveText('1');

  const storedBasket = await page.evaluate(() => JSON.parse(localStorage.getItem('pladesamling_basket')));
  expect(storedBasket).toEqual([availableId]);
});
