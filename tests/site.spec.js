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
  await expect(page.locator('.discount-banner')).toContainText('Jo flere plader, jo billigere');
  await expect(page.locator('.vinyl-card').first().locator('.card-price-label')).toHaveText('Pris nu');
  await expect(page.locator('.card-shelf')).toHaveCount(0);
  await expect(page.locator('.vinyl-card').first().locator('.card-details')).toBeHidden();
  await page.getByRole('button', { name: 'Detaljeret visning' }).click();
  await expect(page.getByRole('button', { name: 'Detaljeret visning' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.vinyl-card').first().locator('.card-details')).toBeVisible();
  await expect(page.locator('.vinyl-card').first().locator('.card-details')).toContainText('Discogs-pris');
  await expect(page.locator('.vinyl-card').first().locator('.card-details')).toContainText('Hylde');
  const genreCount = new Set(availableCatalogue.flatMap(getGenres)).size;
  await expect(page.locator('#genreCount')).toHaveText(String(genreCount));
  await expect(page.locator('#filterRow')).toBeHidden();
  await page.getByRole('button', { name: 'Filtre', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Folk, World, & Country' })).toHaveCount(1);
  await expect(page.getByRole('option', { name: '& Country', exact: true })).toHaveCount(0);

  const layout = await page.locator('#vinylGrid').evaluate(element => ({
    display: getComputedStyle(element).display,
    columns: getComputedStyle(element).gridTemplateColumns.split(' ').length
  }));
  expect(layout.display).toBe('grid');
  expect(layout.columns).toBeGreaterThan(1);
  const controlsFit = await page.locator('.catalogue-controls').evaluate(element =>
    element.scrollWidth <= element.clientWidth
  );
  expect(controlsFit).toBe(true);
  const controlHeights = await page.locator('#searchInput, #sortSelect, #filterToggleBtn').evaluateAll(elements =>
    elements.map(element => Math.round(element.getBoundingClientRect().height))
  );
  expect(new Set(controlHeights).size).toBe(1);
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

test('mobile layout fits without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const mobileLayout = await page.evaluate(() => {
    const grid = document.querySelector('#vinylGrid');
    return {
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      gridDisplay: getComputedStyle(grid).display,
      gridColumns: getComputedStyle(grid).gridTemplateColumns.split(' ').length
    };
  });

  expect(mobileLayout.horizontalOverflow).toBe(false);
  expect(mobileLayout.gridDisplay).toBe('grid');
  expect(mobileLayout.gridColumns).toBe(1);

  await expect(page.locator('#filterRow')).toBeHidden();
  await page.getByRole('button', { name: 'Filtre', exact: true }).click();
  await expect(page.locator('#filterRow')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filtre', exact: true })).toHaveAttribute('aria-expanded', 'true');
  const mobileFilterLayout = await page.evaluate(() => {
    const filters = document.querySelector('#filterRow').getBoundingClientRect();
    const catalogueMeta = document.querySelector('.catalogue-meta-row').getBoundingClientRect();
    return {
      filtersBottom: filters.bottom,
      metaTop: catalogueMeta.top,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(mobileFilterLayout.filtersBottom).toBeLessThanOrEqual(mobileFilterLayout.metaTop);
  expect(mobileFilterLayout.horizontalOverflow).toBe(false);
  await page.getByRole('button', { name: 'Nulstil filtre' }).click();
  await expect(page.locator('#filterRow')).toBeVisible();

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

  await page.getByRole('button', { name: 'Filtre', exact: true }).click();
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

  await page.getByLabel('Sortering', { exact: true }).selectOption('price-desc');
  const firstTwoPrices = await page.locator('.vinyl-card').evaluateAll(cards =>
    cards.slice(0, 2).map(card => Number(card.dataset.priceOre))
  );
  expect(firstTwoPrices[0]).toBeGreaterThanOrEqual(firstTwoPrices[1]);

  await page.getByRole('button', { name: /Vis flere/ }).click();
  await expect(page.locator('.vinyl-card')).toHaveCount(Math.min(PAGE_SIZE * 2, availableCatalogue.length));
});

test('format filter includes non-vinyl media', async ({ page }) => {
  const cds = availableCatalogue.filter(vinyl => vinyl.format === 'CD');
  const cassettes = availableCatalogue.filter(vinyl => vinyl.format === 'Cassette');

  await page.goto('/');
  await page.getByRole('button', { name: 'Filtre', exact: true }).click();
  await expect(page.getByRole('option', { name: 'CD', exact: true })).toHaveCount(1);
  await expect(page.getByRole('option', { name: 'Cassette', exact: true })).toHaveCount(1);

  await page.getByLabel('Filtrer på format').selectOption('CD');
  await expect(page.locator('#resultCount')).toHaveText(formatRecordCount(cds.length));
  await expect(page.locator('.vinyl-card')).toHaveCount(cds.length);
  await expect(page.locator('.vinyl-card').first().locator('.card-meta')).toContainText('CD');

  await page.getByLabel('Filtrer på format').selectOption('Cassette');
  await expect(page.locator('#resultCount')).toHaveText(formatRecordCount(cassettes.length));
  await page.getByRole('button', { name: 'Nulstil filtre' }).click();
  await expect(page.locator('#filterRow')).toBeVisible();
  await expect(page.locator('#resultCount')).toHaveText(formatRecordCount(availableCatalogue.length));
});

test('desktop filters fold away when the catalogue is scrolled', async ({ page }) => {
  await page.goto('/');
  const filterButton = page.getByRole('button', { name: 'Filtre', exact: true });

  await filterButton.click();
  await expect(page.locator('#filterRow')).toBeVisible();
  await expect(filterButton).toHaveAttribute('aria-expanded', 'true');

  await page.mouse.wheel(0, 300);
  await expect(page.locator('#filterRow')).toBeHidden();
  await expect(filterButton).toHaveAttribute('aria-expanded', 'false');
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

  await expect(page.locator('#orderText')).toHaveValue(/#\d+.*Kat\./s);
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

test('100-record mobile orders keep the email action and copy option and preserve the basket', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(ids => {
    localStorage.setItem('pladesamling_basket', JSON.stringify(ids));
    navigator.clipboard.writeText = text => { window.copiedOrder = text; return Promise.resolve(); };
  }, availableCatalogue.slice(0, 100).map(record => record.id));
  await page.goto('/');
  await expect(page.locator('#basketCount')).toHaveText('100');
  await page.getByRole('button', { name: 'Åbn kurv' }).click();
  await page.getByRole('button', { name: 'Gå til bestilling' }).click();
  await page.getByLabel('Navn *').fill('Test Køber');
  await page.getByLabel('Email *').fill('test@example.com');
  await page.getByLabel('Mobil *').fill('12345678');
  await page.getByRole('button', { name: 'Generér bestilling' }).click();
  await expect(page.locator('#emailOrderLink')).toBeVisible();
  await expect(page.locator('#emailOrderLink')).toBeFocused();
  await expect(page.locator('#orderActionBtn')).toBeHidden();
  const text = await page.locator('#orderText').inputValue();
  const href = await page.locator('#emailOrderLink').getAttribute('href');
  expect(href.length).toBeGreaterThan(1800);
  expect(new URL(href).searchParams.get('body')).toBe(text);
  for (const record of availableCatalogue.slice(0, 100)) expect(text).toContain(`#${record.id} ·`);
  expect(text).toContain('Mængderabat (25%)');
  expect(text).toContain('────────────────────────────');
  await page.locator('#copyOrderBtn').click();
  await expect.poll(() => page.evaluate(() => window.copiedOrder)).toBe(text);
  await expect(page.locator('#basketCount')).toHaveText('100');
});

test('volume discount activates from ten valid basket items', async ({ page }) => {
  await page.goto('/');
  for (let index = 0; index < 10; index += 1) {
    await page.locator('button[data-action="add"]:not(:disabled)').first().click();
  }

  await expect(page.locator('#basketCount')).toHaveText('10');
  await page.getByRole('button', { name: 'Åbn kurv' }).click();
  await expect(page.locator('#basketFooter .discount-active')).toHaveText('10% mængderabat aktiveret');
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

test('fixed prices and all volume boundaries match the agreed model', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.vinyl-card')).toHaveCount(PAGE_SIZE);
  const results = await page.evaluate(() => {
    const quantities = [0, 9, 10, 24, 25, 49, 50, 99, 100, 101];
    return quantities.map(count => calculateOrder(Array.from({ length: count }, () => ({ priceNow: 40, discogsPrice: 75 })), 'Forsendelse ønsket'));
  });
  const expected = [[0, 0], [0, 425], [.10, 425], [.10, 929], [.15, 915], [.15, 1731], [.20, 1665], [.20, 3233], [.25, 3065], [.25, 3095]];
  results.forEach((result, index) => {
    expect(result.volumeDiscount).toBe(expected[index][0]);
    expect(result.totalOre).toBe(expected[index][1] * 100);
  });
  const thirty = await page.evaluate(() => [9, 10].map(count => calculateOrder(Array.from({ length: count }, () => ({ priceNow: 30 })), 'Forsendelse ønsket').totalOre));
  expect(thirty).toEqual([33500, 33500]);
  const rounded = await page.evaluate(() => calculateOrder(Array.from({ length: 25 }, () => ({ priceNow: 30 }))));
  expect(rounded.subtotalOre).toBe(63800);
  const prices = await page.locator('.vinyl-card').evaluateAll(cards => cards.map(card => [Number(card.dataset.id), Number(card.dataset.priceOre)]));
  for (const [id, price] of prices) expect(price).toBe(catalogue.find(record => record.id === id).priceNow * 100);
});

test('recommendations require musical relevance and exclude duplicate albums and unavailable records', async ({ page }) => {
  await page.goto('/');
  const ids = await page.evaluate(() => {
    const selected = [{ id: 1, artist: 'Artist A', albumTitle: 'Selected', genres: 'Jazz', released: 1970, priceNow: 30 }];
    const candidates = [
      { id: 2, artist: 'Artist A', albumTitle: 'Other', genres: 'Jazz', released: 1971, priceNow: 40 },
      { id: 3, artist: 'Artist A', albumTitle: 'Selected', genres: 'Jazz', priceNow: 20 },
      { id: 4, artist: 'Artist B', albumTitle: 'Jazz record', genres: 'Jazz', released: 1970, priceNow: 30 },
      { id: 5, artist: 'Artist C', albumTitle: 'Unrelated', genres: 'Rock', priceNow: 20 },
      { id: 6, artist: 'Artist D', albumTitle: 'Weak overlap', genres: 'Jazz, Rock, Pop', priceNow: 20 },
      { id: 7, artist: 'Artist A', albumTitle: 'Sold', genres: 'Jazz', priceNow: 20, status: 'sold' },
      { id: 8, artist: 'Artist A', albumTitle: 'Reserved', genres: 'Jazz', priceNow: 20, status: 'reserved' },
      { id: 9, artist: 'Artist B', albumTitle: 'Jazz record', genres: 'Jazz', priceNow: 35 },
      { id: 10, artist: 'Artist A', albumTitle: 'Different format', genres: 'Jazz', priceNow: 20, format: 'CD' }
    ];
    return getBasketRecommendations(selected, candidates).map(result => result.vinyl.id);
  });
  expect(ids).toEqual([2, 4]);
  const various = await page.evaluate(() => getBasketRecommendations(
    [{ id: 1, artist: 'Various', albumTitle: 'Jazz', genres: 'Jazz', priceNow: 30 }],
    [{ id: 2, artist: 'Various', albumTitle: 'Country', genres: 'Folk, World, & Country', priceNow: 20 }]
  ));
  expect(various).toEqual([]);
});

test('a relevant recommendation shows the real discount benefit and updates the basket', async ({ page }) => {
  const fixtures = Array.from({ length: 9 }, (_, index) => ({
    id: 10000 + index, artist: 'Test Jazz Artist', albumTitle: `Album ${index}`, genres: 'Jazz', released: 1970, priceNow: 30, discogsPrice: 40, status: 'available'
  }));
  fixtures.push({ ...fixtures[0], id: 10009, albumTitle: 'Recommended album', priceNow: 20 });
  fixtures.push({ ...fixtures[0], id: 10010, albumTitle: 'More expensive recommendation', priceNow: 65 });
  await page.route('**/data/vinyls.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixtures) }));
  await page.addInitScript(ids => localStorage.setItem('pladesamling_basket', JSON.stringify(ids)), fixtures.slice(0, 9).map(record => record.id));
  await page.goto('/');
  await expect(page.locator('#catalogueDiscountStatus')).toContainText('1 plade til 10%');
  await expect(page.locator('#catalogueDiscountStatus progress')).toHaveAttribute('value', '9');
  await page.locator('#vinylGrid').scrollIntoViewIfNeeded();
  const statusPosition = await page.locator('#catalogueDiscountStatus').evaluate(element => element.getBoundingClientRect().top);
  expect(statusPosition).toBeGreaterThanOrEqual(64);
  expect(statusPosition).toBeLessThan(300);
  await page.getByRole('button', { name: 'Åbn kurv' }).click();
  await expect(page.locator('.recommendation-tier-note')).toContainText('én valgfri plade');
  await expect(page.locator('.recommendation-benefit').first()).toContainText('261 kr');
  await expect(page.locator('.recommendation-benefit').first()).toContainText('9 kr mindre');
  await expect(page.locator('.recommendation-benefit').last()).toContainText('302 kr');
  await expect(page.locator('.recommendation-benefit').last()).toContainText('32 kr mere');
  await page.locator('.recommendation button').first().click();
  await expect(page.locator('#basketCount')).toHaveText('10');
  await expect(page.locator('.price-row.total')).toContainText('261 kr');
  await expect(page.locator('.recommendation-benefit')).toHaveCount(0);
  await expect(page.locator('#catalogueDiscountStatus')).toContainText('10% mængderabat aktiveret');
  await page.locator('.basket-item:not(.recommendation)').last().getByRole('button', { name: /Fjern/ }).click();
  await expect(page.locator('#basketCount')).toHaveText('9');
  await expect(page.locator('.recommendation-benefit').first()).toContainText('261 kr');
  await expect(page.locator('#catalogueDiscountStatus progress')).toHaveAttribute('value', '9');
});

test('saved duplicate IDs migrate to the surviving identical record', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pladesamling_basket', JSON.stringify([2485, 2293, 2484])));
  await page.goto('/');
  await expect(page.locator('#basketCount')).toHaveText('2');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pladesamling_basket')))).toEqual([2484, 2290]);
});

test('checkout adds shipping after discounts while desktop keeps the copy action', async ({ page }) => {
  await page.goto('/');
  await page.locator('.vinyl-card').first().getByRole('button', { name: 'Læg i kurv' }).click();
  await page.getByRole('button', { name: 'Åbn kurv' }).click();
  await page.getByRole('button', { name: 'Gå til bestilling' }).click();
  const before = await page.locator('#checkoutSummary').textContent();
  await page.locator('#fieldLevering').selectOption('Forsendelse ønsket');
  const after = await page.locator('#checkoutSummary').textContent();
  expect(Number(after.match(/Total (\d+) kr/)[1]) - Number(before.match(/Total (\d+) kr/)[1])).toBe(65);
  await page.locator('#fieldNavn').fill('Test');
  await page.locator('#fieldEmail').fill('test@example.com');
  await page.locator('#fieldMobil').fill('12345678');
  await page.getByRole('button', { name: 'Generér bestilling' }).click();
  await expect(page.locator('#orderText')).toHaveValue(/Fragt:\s+65 kr/);
  await expect(page.locator('#emailOrderLink')).toBeHidden();
  await expect(page.locator('#orderActionBtn')).toBeVisible();
});
