/* app.js — Pladesamling vinyl shop */

// =============================================
// Constants
// =============================================
const VOLUME_TIERS = [
  { min: 100, discount: 0.25 },
  { min: 50, discount: 0.20 },
  { min: 25, discount: 0.15 },
  { min: 10, discount: 0.10 }
];
const SHIPPING_FEE_ORE = 6500;
const PAGE_SIZE = 48;
const ORDER_EMAIL = 'mellemvej12@gmail.com';
const BASKET_STORAGE_KEY = 'pladesamling_basket';
const COMBINED_COUNTRY_GENRE = 'Folk, World, & Country';
const VALID_STATUSES = new Set(['available', 'reserved', 'sold']);
const PHONE_ORDER_ACTION_MEDIA = window.matchMedia('(max-width: 767px)');
const MOBILE_FILTERS_MEDIA = window.matchMedia('(max-width: 768px)');

// =============================================
// State
// =============================================
let allVinyls = [];
let vinylById = new Map();
let filteredVinyls = [];
let basket = [];
let displayCount = PAGE_SIZE;
let catalogueLoadError = false;
let focusReturnTarget = null;

// =============================================
// Utility and pricing
// =============================================
function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function priceToOre(value) {
  const price = Number(value);
  return Number.isFinite(price) ? Math.round(price * 100) : 0;
}

function getDisplayPriceOre(vinyl) {
  return priceToOre(vinyl.priceNow);
}

function formatPriceOre(ore) {
  return Math.round(ore / 100).toLocaleString('da-DK') + ' kr';
}

function formatRecordCount(count) {
  return `${count.toLocaleString('da-DK')} ${count === 1 ? 'plade' : 'plader'}`;
}

function getVolumeDiscount(count) {
  for (const tier of VOLUME_TIERS) {
    if (count >= tier.min) return tier.discount;
  }
  return 0;
}

function getNextTier(count) {
  const ascendingTiers = [...VOLUME_TIERS].reverse();
  for (const tier of ascendingTiers) {
    if (tier.min > count && tier.discount > 0) {
      return { needed: tier.min - count, discount: tier.discount };
    }
  }
  return null;
}

function formatDiscountPct(discount) {
  return (discount * 100).toLocaleString('da-DK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  }) + '%';
}

function calculateOrder(items, delivery = 'Afhentning ønsket') {
  const discogsTotalOre = items.reduce((sum, vinyl) => sum + priceToOre(vinyl.discogsPrice), 0);
  const baseSubtotalOre = items.reduce((sum, vinyl) => sum + getDisplayPriceOre(vinyl), 0);
  const volumeDiscount = getVolumeDiscount(items.length);
  const subtotalOre = Math.round(baseSubtotalOre * (1 - volumeDiscount) / 100) * 100;
  const volumeAmountOre = baseSubtotalOre - subtotalOre;
  const shippingOre = items.length && delivery === 'Forsendelse ønsket' ? SHIPPING_FEE_ORE : 0;

  return {
    discogsTotalOre,
    baseSubtotalOre,
    volumeDiscount,
    volumeAmountOre,
    subtotalOre,
    shippingOre,
    totalOre: subtotalOre + shippingOre
  };
}

function recommendationKey(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('da-DK');
}

function getBasketRecommendations(items, catalogue = allVinyls) {
  if (!items.length) return [];
  const selected = new Set(items.map(item => Number(item.id)));
  const albums = new Set(items.map(item => `${recommendationKey(item.artist)}|${recommendationKey(item.albumTitle)}`));
  const nextTier = getNextTier(items.length);
  const suggestions = [];
  for (const vinyl of catalogue) {
    if (getVinylStatus(vinyl) !== 'available' || selected.has(Number(vinyl.id)) ||
      albums.has(`${recommendationKey(vinyl.artist)}|${recommendationKey(vinyl.albumTitle)}`)) continue;
    const genres = getGenres(vinyl);
    let best = null;
    for (const item of items) {
      if (getFormat(vinyl) !== getFormat(item)) continue;
      const artist = recommendationKey(vinyl.artist);
      const sameArtist = artist && !['various', 'various artists', 'unknown', 'ukendt kunstner'].includes(artist) && artist === recommendationKey(item.artist);
      const itemGenres = getGenres(item);
      const shared = genres.filter(genre => itemGenres.includes(genre));
      const similarity = shared.length / new Set([...genres, ...itemGenres]).size;
      // A broad overlapping tag alone is insufficient for a musical recommendation.
      if (!sameArtist && !(shared.length && similarity >= 0.75)) continue;
      const years = [Number(vinyl.released), Number(item.released)];
      const yearBonus = years.every(year => Number.isFinite(year) && year > 0)
        ? Math.max(0, 10 - Math.abs(years[0] - years[1])) : 0;
      const score = (sameArtist ? 100 : 40 + similarity * 20) + yearBonus;
      const reason = sameArtist ? `Mere med ${item.artist}` : `${shared.join(' / ')} som i din kurv`;
      if (!best || score > best.score) best = { vinyl, score, reason };
    }
    if (best) suggestions.push(best);
  }
  suggestions.sort((a, b) => {
    const priceDiff = getDisplayPriceOre(a.vinyl) - getDisplayPriceOre(b.vinyl);
    // Near a tier, prefer affordable options within the same relevance group.
    const artistDiff = Number(b.score >= 100) - Number(a.score >= 100);
    return artistDiff || (nextTier?.needed === 1 ? priceDiff : 0) || b.score - a.score || priceDiff || Number(a.vinyl.id) - Number(b.vinyl.id);
  });
  const seen = new Set();
  return suggestions.filter(({ vinyl }) => {
    const key = `${recommendationKey(vinyl.artist)}|${recommendationKey(vinyl.albumTitle)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
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

function getFormat(vinyl) {
  const value = vinyl.format == null ? '' : String(vinyl.format).trim();
  return value || 'Ukendt format';
}

function getSortSelect() {
  return document.getElementById(MOBILE_FILTERS_MEDIA.matches ? 'sortSelectMobile' : 'sortSelect');
}

function closeFilterPanel({ restoreFocus = false } = {}) {
  const filterRow = document.getElementById('filterRow');
  const filterToggle = document.getElementById('filterToggleBtn');
  if (!filterRow.classList.contains('open')) return;

  filterRow.classList.remove('open');
  filterToggle.setAttribute('aria-expanded', 'false');
  if (restoreFocus) filterToggle.focus({ preventScroll: true });
}

function normalizeCountry(country) {
  const value = country == null ? '' : String(country).trim();
  return !value || value.toLowerCase() === 'null' ? 'Unknown' : value;
}

function resolveBasketItems() {
  return basket.map(id => vinylById.get(id)).filter(Boolean);
}

function getVinylStatus(vinyl) {
  // Keep old data compatible while status replaces the former sold boolean.
  if (!vinyl.status) return vinyl.sold ? 'sold' : 'available';
  return String(vinyl.status).toLowerCase().trim();
}

// =============================================
// Initialization
// =============================================
async function init() {
  bindEvents();
  configureEmailLinks();
  loadBasket();
  document.getElementById('resultCount').textContent = 'Henter katalog…';

  try {
    const response = await fetch('data/vinyls.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Katalog: HTTP ${response.status}`);
    const raw = await response.json();
    if (!Array.isArray(raw)) throw new Error('Katalogfilen mangler eller er ugyldig.');
    for (const vinyl of raw) {
      const status = getVinylStatus(vinyl);
      if (!VALID_STATUSES.has(status)) {
        throw new Error(`Ugyldig status for plade #${vinyl.id}: ${vinyl.status}`);
      }
      if (!Number.isInteger(vinyl.priceNow) || vinyl.priceNow <= 0) {
        throw new Error(`Ugyldig pris for plade #${vinyl.id}`);
      }
    }
    allVinyls = raw.filter(vinyl => getVinylStatus(vinyl) === 'available');
    vinylById = new Map(allVinyls.map(vinyl => [Number(vinyl.id), vinyl]));
    const previousIds = new Map(allVinyls.flatMap(vinyl =>
      (vinyl.previousIds || []).map(id => [Number(id), Number(vinyl.id)])));
    basket = basket.map(id => vinylById.has(Number(id)) ? id : previousIds.get(Number(id)) || id);
    saveBasket();
    reconcileBasket();
    populateFilters();
    updateCatalogueStats();
  } catch (error) {
    console.error('Kunne ikke hente kataloget.', error);
    catalogueLoadError = true;
    allVinyls = [];
    vinylById = new Map();
  }

  filterAndSort();
  updateBasketUI();
}

function configureEmailLinks() {
  document.querySelectorAll('[data-order-email]').forEach(link => {
    link.textContent = ORDER_EMAIL;
    link.href = `mailto:${ORDER_EMAIL}`;
  });
}

function reconcileBasket() {
  const cleaned = [...new Set(
    basket
      .map(Number)
      .filter(Number.isFinite)
      .filter(id => vinylById.has(id))
  )];

  if (cleaned.length !== basket.length || cleaned.some((id, index) => id !== basket[index])) {
    basket = cleaned;
    saveBasket();
  }
}

function updateCatalogueStats() {
  const genres = new Set(allVinyls.flatMap(getGenres));
  const artists = new Set(allVinyls.map(vinyl => String(vinyl.artist).trim().toLocaleLowerCase('da-DK')));
  const years = allVinyls
    .map(vinyl => Number(vinyl.released))
    .filter(year => Number.isFinite(year) && year > 0);
  const yearRange = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '—';

  document.getElementById('recordCount').textContent = allVinyls.length.toLocaleString('da-DK');
  document.getElementById('genreCount').textContent = genres.size.toLocaleString('da-DK');
  document.getElementById('artistCount').textContent = artists.size.toLocaleString('da-DK');
  document.getElementById('heroYearRange').textContent = yearRange;
}

// =============================================
// Filters and sorting
// =============================================
function populateFilters() {
  const genres = new Set();
  const formats = new Set();
  const countries = new Set();
  const decades = new Set();

  for (const vinyl of allVinyls) {
    formats.add(getFormat(vinyl));
    getGenres(vinyl).forEach(genre => genres.add(genre));
    countries.add(normalizeCountry(vinyl.country));

    const year = Number(vinyl.released);
    if (Number.isFinite(year) && year > 0) decades.add(Math.floor(year / 10) * 10);
  }

  fillSelect('formatFilter', [...formats].sort((a, b) => a.localeCompare(b, 'da')), value => value, value => value);
  fillSelect('genreFilter', [...genres].sort((a, b) => a.localeCompare(b, 'da')), value => value, value => value);
  fillSelect('countryFilter', [...countries].sort((a, b) => a.localeCompare(b, 'da')), value => value, value => value);
  fillSelect(
    'decadeFilter',
    [...decades].sort((a, b) => a - b),
    decade => `${decade}'erne`,
    decade => String(decade)
  );
}

function fillSelect(id, items, labelFn, valueFn) {
  const select = document.getElementById(id);
  const firstOption = select.options[0];
  select.replaceChildren(firstOption);

  for (const item of items) {
    const option = document.createElement('option');
    option.value = valueFn(item);
    option.textContent = labelFn(item);
    select.appendChild(option);
  }
}

function filterAndSort() {
  const query = document.getElementById('searchInput').value.toLocaleLowerCase('da-DK').trim();
  const format = document.getElementById('formatFilter').value;
  const genre = document.getElementById('genreFilter').value;
  const country = document.getElementById('countryFilter').value;
  const decade = document.getElementById('decadeFilter').value;
  const sort = getSortSelect().value;

  const activeFilterCount = [format, genre, country, decade].filter(Boolean).length;
  const filterToggle = document.getElementById('filterToggleBtn');
  filterToggle.textContent = activeFilterCount ? `Filtre (${activeFilterCount})` : 'Filtre';

  filteredVinyls = allVinyls.filter(vinyl => {
    if (query) {
      const searchable = [vinyl.artist, vinyl.albumTitle, vinyl.catNo, getFormat(vinyl), ...getGenres(vinyl)]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('da-DK');
      if (!searchable.includes(query)) return false;
    }

    if (format && getFormat(vinyl) !== format) return false;
    if (genre && !getGenres(vinyl).includes(genre)) return false;
    if (country && normalizeCountry(vinyl.country) !== country) return false;

    if (decade) {
      const year = Number(vinyl.released);
      if (!Number.isFinite(year) || String(Math.floor(year / 10) * 10) !== decade) return false;
    }

    return true;
  });

  const byArtistThenTitle = (a, b) => {
    const artistComparison = String(a.artist || '').localeCompare(String(b.artist || ''), 'da');
    return artistComparison || String(a.albumTitle || '').localeCompare(String(b.albumTitle || ''), 'da');
  };

  switch (sort) {
    case 'price-asc':
      filteredVinyls.sort((a, b) => getDisplayPriceOre(a) - getDisplayPriceOre(b) || byArtistThenTitle(a, b));
      break;
    case 'price-desc':
      filteredVinyls.sort((a, b) => getDisplayPriceOre(b) - getDisplayPriceOre(a) || byArtistThenTitle(a, b));
      break;
    case 'year-asc':
      filteredVinyls.sort((a, b) => (Number(a.released) || 9999) - (Number(b.released) || 9999) || byArtistThenTitle(a, b));
      break;
    case 'year-desc':
      filteredVinyls.sort((a, b) => (Number(b.released) || 0) - (Number(a.released) || 0) || byArtistThenTitle(a, b));
      break;
    default:
      filteredVinyls.sort(byArtistThenTitle);
  }

  displayCount = PAGE_SIZE;
  renderCatalogue();
}

function resetFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('formatFilter').value = '';
  document.getElementById('genreFilter').value = '';
  document.getElementById('countryFilter').value = '';
  document.getElementById('decadeFilter').value = '';
  document.getElementById('sortSelect').value = 'artist-az';
  document.getElementById('sortSelectMobile').value = 'artist-az';
  filterAndSort();
}

// =============================================
// Catalogue rendering
// =============================================
function renderCatalogue() {
  const grid = document.getElementById('vinylGrid');
  const countElement = document.getElementById('resultCount');
  const loadMoreButton = document.getElementById('loadMoreBtn');

  if (catalogueLoadError) {
    grid.innerHTML = '<div class="empty-state"><h3>Kataloget kunne ikke hentes</h3><p>Kontrollér forbindelsen, og prøv igen.</p><button class="btn-secondary" type="button" data-action="reload">Genindlæs siden</button></div>';
    countElement.textContent = '';
    loadMoreButton.hidden = true;
    return;
  }

  if (filteredVinyls.length === 0) {
    grid.innerHTML = '<div class="empty-state"><h3>Ingen plader fundet</h3><p>Prøv at justere dine søgekriterier.</p></div>';
    countElement.textContent = formatRecordCount(0);
    loadMoreButton.hidden = true;
    return;
  }

  const visibleVinyls = filteredVinyls.slice(0, displayCount);
  countElement.textContent = formatRecordCount(filteredVinyls.length);
  grid.innerHTML = visibleVinyls.map(renderCard).join('');

  const remaining = filteredVinyls.length - displayCount;
  loadMoreButton.hidden = remaining <= 0;
  if (remaining > 0) loadMoreButton.textContent = `Vis flere (${Math.min(PAGE_SIZE, remaining)} mere)`;
}

function renderCard(vinyl) {
  const id = Number(vinyl.id);
  const artist = escapeHtml(vinyl.artist || 'Ukendt kunstner');
  const title = escapeHtml(vinyl.albumTitle || 'Ukendt album');
  const year = vinyl.released ? escapeHtml(vinyl.released) : '';
  const country = escapeHtml(normalizeCountry(vinyl.country));
  const catNo = escapeHtml(vinyl.catNo || '');
  const shelf = vinyl.shelf == null || vinyl.shelf === '' ? '—' : escapeHtml(vinyl.shelf);
  const genres = getGenres(vinyl);
  const format = getFormat(vinyl);
  const genreDisplay = genres.map(value => `<span class="card-genre">${escapeHtml(value)}</span>`).join('');
  const displayPriceOre = getDisplayPriceOre(vinyl);
  const inBasket = basket.includes(id);
  const meta = [format, year, country].filter(Boolean).join(' · ');

  return `
<article class="vinyl-card${inBasket ? ' in-basket' : ''}" data-id="${id}" data-price-ore="${displayPriceOre}">
  <div class="card-artist">${artist}</div>
  <div class="card-title">${title}</div>
  <div class="card-meta">${meta}</div>
  ${genreDisplay ? `<div class="card-genres">${genreDisplay}</div>` : ''}
  ${catNo ? `<div class="card-catno">${catNo}</div>` : ''}
  <div class="card-details">
    <div><span>Discogs-pris</span><strong>${formatPriceOre(priceToOre(vinyl.discogsPrice))}</strong></div>
    <div><span>Hylde</span><strong>${shelf}</strong></div>
    <div><span>Format</span><strong>${escapeHtml(format)}</strong></div>
    <div><span>Pladenummer</span><strong>#${id}</strong></div>
    <div><span>Katalognummer</span><strong>${catNo || '—'}</strong></div>
  </div>
  <div class="card-footer">
    <span class="card-price-wrap">
      <span class="card-reference-price">Discogs <s>${formatPriceOre(priceToOre(vinyl.discogsPrice))}</s></span>
      <span class="card-current-price">
        <span class="card-price-label">Pris nu</span>
        <span class="card-price">${formatPriceOre(displayPriceOre)}</span>
      </span>
    </span>
    <button class="btn-primary${inBasket ? ' in-basket' : ''}" type="button" data-action="${inBasket ? 'remove' : 'add'}" data-id="${id}"${inBasket ? ' aria-label="Fjern fra kurv" title="Klik for at fjerne fra kurven"' : ''}>${inBasket ? 'I kurven ✓' : 'Læg i kurv'}</button>
  </div>
</article>`.trim();
}

// =============================================
// Basket
// =============================================
function loadBasket() {
  try {
    const stored = JSON.parse(localStorage.getItem(BASKET_STORAGE_KEY) || '[]');
    basket = Array.isArray(stored) ? stored : [];
  } catch {
    basket = [];
  }
}

function saveBasket() {
  try {
    localStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(basket));
  } catch {
    // The basket still works for the current page view when storage is unavailable.
  }
}

function addToBasket(id) {
  const numericId = Number(id);
  if (!vinylById.has(numericId) || basket.includes(numericId)) return;

  basket.push(numericId);
  saveBasket();
  updateBasketUI();
  renderCatalogue();
}

function removeFromBasket(id) {
  const numericId = Number(id);
  basket = basket.filter(basketId => basketId !== numericId);
  saveBasket();
  updateBasketUI();
  renderCatalogue();
}

function clearBasket() {
  basket = [];
  saveBasket();
  updateBasketUI();
  renderCatalogue();
}

function updateCatalogueDiscountStatus(count) {
  const element = document.getElementById('catalogueDiscountStatus');
  element.hidden = catalogueLoadError;
  const nextTier = getNextTier(count);
  const discount = getVolumeDiscount(count);
  const hint = nextTier
    ? `${nextTier.needed} ${nextTier.needed === 1 ? 'plade' : 'plader'} til ${formatDiscountPct(nextTier.discount)}`
    : 'Største rabat nået';
  const target = nextTier ? count + nextTier.needed : 100;
  element.innerHTML = `<strong class="catalogue-active-discount">${discount ? `${formatDiscountPct(discount)} mængderabat aktiveret` : ''}</strong>
    <progress class="discount-progress" value="${Math.min(count, target)}" max="${target}" aria-label="${nextTier ? `${count} af ${target} plader til næste rabattrin` : 'Største rabat nået'}"></progress>
    <span class="catalogue-next-discount">${hint}</span>`;
}

function updateBasketUI() {
  const items = resolveBasketItems();
  const count = items.length;
  document.getElementById('basketCount').textContent = count;
  updateCatalogueDiscountStatus(count);

  const body = document.getElementById('basketBody');
  const footer = document.getElementById('basketFooter');

  if (count === 0) {
    body.innerHTML = '<p class="basket-empty">Din kurv er tom<br>Tag 10 plader med og få 10 % på pladerne.</p>';
    footer.innerHTML = '';
    return;
  }

  body.innerHTML = items.map(vinyl => `
<div class="basket-item">
  <div class="basket-item-info">
    <div class="basket-item-artist">${escapeHtml(vinyl.artist || '')}</div>
    <div class="basket-item-title">${escapeHtml(vinyl.albumTitle || '')}</div>
    <div class="basket-item-price">${formatPriceOre(getDisplayPriceOre(vinyl))}</div>
  </div>
  <button class="basket-remove" type="button" data-action="remove" data-id="${Number(vinyl.id)}" aria-label="Fjern ${escapeHtml(vinyl.artist || '')} – ${escapeHtml(vinyl.albumTitle || '')} fra kurven">×</button>
</div>`.trim()).join('');

  const totals = calculateOrder(items);
  const nextTier = getNextTier(count);
  const recommendations = getBasketRecommendations(items);
  if (recommendations.length) {
    body.innerHTML += `<section class="basket-recommendations" aria-label="Plader der passer til din kurv">
      <h3>Passer til din kurv</h3>
      ${nextTier?.needed === 1 ? `<p class="recommendation-tier-note">Tilføj én valgfri plade, og få ${formatDiscountPct(nextTier.discount)} på alle pladerne i kurven.</p>` : ''}
      ${recommendations.map(({ vinyl, reason }) => {
        const nextTotal = calculateOrder([...items, vinyl]);
        const saving = totals.subtotalOre - nextTotal.subtotalOre;
        const benefit = nextTier?.needed === 1
          ? `<p class="recommendation-benefit"><span>Ny total for pladerne: ${formatPriceOre(nextTotal.subtotalOre)}</span><span>${saving > 0 ? `${formatPriceOre(saving)} mindre end nu` : saving < 0 ? `${formatPriceOre(-saving)} mere end nu` : 'Samme pris som nu'}.</span></p>` : '';
        return `<div class="basket-item recommendation" data-recommendation-id="${Number(vinyl.id)}">
          <div class="basket-item-info">
            <div class="basket-item-artist">${escapeHtml(vinyl.artist)}</div>
            <div class="basket-item-title">${escapeHtml(vinyl.albumTitle)}</div>
            <p class="recommendation-reason">${escapeHtml(reason)}</p>
            <div class="basket-item-price">${formatPriceOre(getDisplayPriceOre(vinyl))}</div>
            ${benefit}
          </div>
          <button class="btn-secondary" type="button" data-action="add" data-id="${Number(vinyl.id)}" aria-label="Læg ${escapeHtml(vinyl.artist)} – ${escapeHtml(vinyl.albumTitle)} i kurv">Tilføj</button>
        </div>`;
      }).join('')}
    </section>`;
  }
  let footerHtml = '';

  if (totals.volumeDiscount > 0) {
    footerHtml += `<p class="discount-active">${formatDiscountPct(totals.volumeDiscount)} mængderabat aktiveret</p>`;
  }
  if (nextTier) {
    const target = count + nextTier.needed;
    footerHtml += `<progress class="discount-progress" value="${count}" max="${target}" aria-label="${count} af ${target} plader til næste rabattrin"></progress>`;
    footerHtml += `<p class="discount-hint">Tilføj ${nextTier.needed} ${nextTier.needed === 1 ? 'plade' : 'plader'} mere, og få ${formatDiscountPct(nextTier.discount)} på alle pladerne</p>`;
  }

  footerHtml += `<div class="price-breakdown">
  <div class="price-row"><span>Sum af priser</span><span>${formatPriceOre(totals.baseSubtotalOre)}</span></div>
  ${totals.volumeDiscount > 0 ? `<div class="price-row"><span>Mængderabat (${formatDiscountPct(totals.volumeDiscount)})</span><span>−${formatPriceOre(totals.volumeAmountOre)}</span></div>` : ''}
  <div class="price-row total"><span>Total</span><span>${formatPriceOre(totals.totalOre)}</span></div>
  <p class="delivery-note">Afhentning gratis · Forsendelse +65 kr.</p>
</div>
<button class="btn-primary btn-full" type="button" data-action="checkout">Gå til bestilling</button>`;

  footer.innerHTML = footerHtml;
}

// =============================================
// Panels and focus management
// =============================================
function syncBodyScrollLock() {
  const anyPanelOpen = document.getElementById('basketSidebar').classList.contains('open')
    || document.getElementById('checkoutOverlay').classList.contains('open');
  document.body.classList.toggle('panel-open', anyPanelOpen);
}

function restoreFocus() {
  if (focusReturnTarget && document.contains(focusReturnTarget)) focusReturnTarget.focus();
  focusReturnTarget = null;
}

function openBasket() {
  focusReturnTarget = document.activeElement;
  const sidebar = document.getElementById('basketSidebar');
  sidebar.inert = false;
  sidebar.classList.add('open');
  sidebar.setAttribute('aria-hidden', 'false');
  document.getElementById('basketOverlay').classList.add('active');
  document.getElementById('basketOverlay').setAttribute('aria-hidden', 'false');
  document.getElementById('basketBtn').setAttribute('aria-expanded', 'true');
  syncBodyScrollLock();
  document.getElementById('closeBasketBtn').focus();
}

function closeBasket(shouldRestoreFocus = true) {
  const sidebar = document.getElementById('basketSidebar');
  if (!sidebar.classList.contains('open')) return;

  sidebar.classList.remove('open');
  sidebar.setAttribute('aria-hidden', 'true');
  sidebar.inert = true;
  document.getElementById('basketOverlay').classList.remove('active');
  document.getElementById('basketOverlay').setAttribute('aria-hidden', 'true');
  document.getElementById('basketBtn').setAttribute('aria-expanded', 'false');
  syncBodyScrollLock();
  if (shouldRestoreFocus) restoreFocus();
}

function clearValidation() {
  ['fieldNavn', 'fieldEmail', 'fieldMobil'].forEach(id => {
    const field = document.getElementById(id);
    field.classList.remove('invalid');
    field.removeAttribute('aria-invalid');
    field.setCustomValidity('');
  });
  ['errorNavn', 'errorEmail', 'errorMobil'].forEach(id => {
    document.getElementById(id).textContent = '';
  });
}

function openCheckout(returnTarget = document.activeElement) {
  focusReturnTarget = returnTarget;
  const overlay = document.getElementById('checkoutOverlay');
  overlay.inert = false;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.getElementById('checkoutForm').style.display = '';
  document.getElementById('orderResult').style.display = 'none';
  document.getElementById('checkoutForm').reset();
  clearValidation();
  document.getElementById('copyConfirm').hidden = true;
  updateCheckoutSummary();
  syncBodyScrollLock();
  document.getElementById('closeCheckoutBtn').focus();
}

function updateCheckoutSummary() {
  const items = resolveBasketItems();
  const totals = calculateOrder(items, document.getElementById('fieldLevering').value);
  document.getElementById('checkoutSummary').textContent = `${formatRecordCount(items.length)} · Total ${formatPriceOre(totals.totalOre)}`;
}

function closeCheckout(shouldRestoreFocus = true) {
  const overlay = document.getElementById('checkoutOverlay');
  if (!overlay.classList.contains('open')) return;

  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  syncBodyScrollLock();
  if (shouldRestoreFocus) restoreFocus();
}

function getOpenPanel() {
  if (document.getElementById('checkoutOverlay').classList.contains('open')) {
    return document.querySelector('#checkoutOverlay .modal');
  }
  if (document.getElementById('basketSidebar').classList.contains('open')) {
    return document.getElementById('basketSidebar');
  }
  return null;
}

function trapFocus(event) {
  if (event.key !== 'Tab') return;
  const panel = getOpenPanel();
  if (!panel) return;

  const focusable = [...panel.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')]
    .filter(element => element.offsetParent !== null);
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// =============================================
// Checkout
// =============================================
function setFieldError(field, errorElement, message) {
  field.setCustomValidity(message);
  field.classList.toggle('invalid', Boolean(message));
  field.setAttribute('aria-invalid', message ? 'true' : 'false');
  errorElement.textContent = message;
}

function validateCheckoutForm() {
  const nameField = document.getElementById('fieldNavn');
  const emailField = document.getElementById('fieldEmail');
  const phoneField = document.getElementById('fieldMobil');

  const nameError = nameField.value.trim() ? '' : 'Skriv dit navn.';
  let emailError = '';
  if (!emailField.value.trim()) emailError = 'Skriv din emailadresse.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.value.trim())) emailError = 'Skriv en gyldig emailadresse.';

  const phoneDigits = phoneField.value.replace(/\D/g, '');
  let phoneError = '';
  if (!phoneField.value.trim()) phoneError = 'Skriv dit mobilnummer.';
  else if (phoneDigits.length < 6) phoneError = 'Skriv et gyldigt mobilnummer.';

  setFieldError(nameField, document.getElementById('errorNavn'), nameError);
  setFieldError(emailField, document.getElementById('errorEmail'), emailError);
  setFieldError(phoneField, document.getElementById('errorMobil'), phoneError);

  const firstInvalid = [nameField, emailField, phoneField].find(field => !field.validity.valid);
  if (firstInvalid) firstInvalid.focus();
  return !firstInvalid;
}

function generateOrderText(name, email, phone, delivery, message) {
  const items = resolveBasketItems();
  const totals = calculateOrder(items, delivery);

  const itemLines = items.map(vinyl => {
    const details = [
      vinyl.released || null,
      normalizeCountry(vinyl.country),
      vinyl.catNo ? `Kat.nr. ${vinyl.catNo}` : null,
      vinyl.shelf != null && vinyl.shelf !== '' ? `Hylde ${vinyl.shelf}` : null
    ].filter(Boolean).join(' · ');

    return `  #${vinyl.id} · ${vinyl.artist || '?'} — ${vinyl.albumTitle || '?'}\n    ${details}\n    Discogs-pris ${formatPriceOre(priceToOre(vinyl.discogsPrice))} → ${formatPriceOre(getDisplayPriceOre(vinyl))}`;
  }).join('\n\n');

  const volumeLine = totals.volumeDiscount > 0
    ? `Mængderabat (${formatDiscountPct(totals.volumeDiscount)}):   −${formatPriceOre(totals.volumeAmountOre)}`
    : null;

  const lines = [
    `Emne: Ny bestilling fra ${name} — ${formatRecordCount(items.length)}, ${formatPriceOre(totals.totalOre)}`,
    '',
    'Hej',
    '',
    'Jeg vil gerne bestille følgende plader fra jeres samling:',
    '',
    itemLines,
    '',
    '────────────────────────────',
    `Sum af priser:         ${formatPriceOre(totals.baseSubtotalOre)}`,
    ...(volumeLine ? [volumeLine] : []),
    `Fragt:                 ${formatPriceOre(totals.shippingOre)}`,
    `Total:                 ${formatPriceOre(totals.totalOre)}`,
    '────────────────────────────',
    '',
    `Levering: ${delivery}`,
    ...(message ? ['', 'Besked:', message] : []),
    '',
    'Mine kontaktoplysninger:',
    `  Navn: ${name}`,
    `  Email: ${email}`,
    `  Mobil: ${phone}`,
    '',
    'Mvh',
    name
  ];

  return lines.join('\n');
}

function shouldUsePhoneOrderAction() {
  return PHONE_ORDER_ACTION_MEDIA.matches;
}

function updateOrderActionUi() {
  const isPhone = shouldUsePhoneOrderAction();
  const desktopAction = document.getElementById('orderActionBtn');
  const emailAction = document.getElementById('emailOrderLink');
  const copyFallback = document.getElementById('copyOrderBtn');
  const emailHref = buildOrderEmailHref();
  const canOpenEmail = isPhone;

  desktopAction.hidden = canOpenEmail;
  emailAction.hidden = !canOpenEmail;
  if (canOpenEmail) emailAction.href = emailHref;
  else emailAction.removeAttribute('href');
  copyFallback.hidden = !canOpenEmail;
  document.getElementById('orderInstructionsPrefix').textContent = canOpenEmail
    ? 'Åbn en ny email til '
    : 'Kopiér teksten og send den som en email til ';
  document.getElementById('orderInstructionsSuffix').textContent = canOpenEmail
    ? ' med modtager, emne og bestilling udfyldt. Hvis der ikke åbnes en emailapp, kan du kopiere teksten i stedet. Din kurv gemmes, indtil du selv rydder den efter afsendelse.'
    : '. Din kurv gemmes, indtil du selv rydder den efter afsendelse.';
  return canOpenEmail ? emailAction : desktopAction;
}

function buildOrderEmailHref() {
  const subject = encodeURIComponent('Ny bestilling');
  const body = encodeURIComponent(document.getElementById('orderText').value);
  return `mailto:${ORDER_EMAIL}?subject=${subject}&body=${body}`;
}

async function copyOrderText(
  successMessage = '✓ Kopieret!',
  failureMessage = 'Kopiering mislykkedes – markér teksten og kopiér manuelt.'
) {
  const orderText = document.getElementById('orderText');
  let copied = false;

  try {
    await navigator.clipboard.writeText(orderText.value);
    copied = true;
  } catch {
    try {
      orderText.select();
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
  }

  const confirmation = document.getElementById('copyConfirm');
  confirmation.textContent = copied ? successMessage : failureMessage;
  confirmation.hidden = false;
  if (copied) window.setTimeout(() => { confirmation.hidden = true; }, 2500);
  return copied;
}

// =============================================
// Events
// =============================================
function bindEvents() {
  document.getElementById('searchInput').addEventListener('input', filterAndSort);
  document.getElementById('formatFilter').addEventListener('change', filterAndSort);
  document.getElementById('genreFilter').addEventListener('change', filterAndSort);
  document.getElementById('countryFilter').addEventListener('change', filterAndSort);
  document.getElementById('decadeFilter').addEventListener('change', filterAndSort);
  document.getElementById('sortSelect').addEventListener('change', filterAndSort);
  document.getElementById('sortSelectMobile').addEventListener('change', filterAndSort);
  document.getElementById('resetFiltersBtn').addEventListener('click', resetFilters);
  document.getElementById('detailedViewBtn').addEventListener('click', event => {
    const grid = document.getElementById('vinylGrid');
    const isDetailed = grid.classList.toggle('detailed');
    event.currentTarget.setAttribute('aria-pressed', String(isDetailed));
  });
  document.getElementById('filterToggleBtn').addEventListener('click', event => {
    const filterRow = document.getElementById('filterRow');
    const isOpen = filterRow.classList.toggle('open');
    event.currentTarget.setAttribute('aria-expanded', String(isOpen));
  });

  window.addEventListener('wheel', () => {
    if (!MOBILE_FILTERS_MEDIA.matches) closeFilterPanel({ restoreFocus: true });
  }, { passive: true });

  window.addEventListener('touchmove', () => {
    if (!MOBILE_FILTERS_MEDIA.matches) closeFilterPanel({ restoreFocus: true });
  }, { passive: true });

  document.addEventListener('pointerdown', event => {
    const filterRow = document.getElementById('filterRow');
    const filterToggle = document.getElementById('filterToggleBtn');
    if (!MOBILE_FILTERS_MEDIA.matches && filterRow.classList.contains('open')
      && !filterRow.contains(event.target) && !filterToggle.contains(event.target)) {
      closeFilterPanel();
    }
  });

  document.getElementById('loadMoreBtn').addEventListener('click', () => {
    displayCount += PAGE_SIZE;
    renderCatalogue();
  });

  document.getElementById('vinylGrid').addEventListener('click', event => {
    const action = event.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'add') addToBasket(action.dataset.id);
    if (action.dataset.action === 'remove') removeFromBasket(action.dataset.id);
    if (action.dataset.action === 'reload') window.location.reload();
  });

  document.getElementById('basketBody').addEventListener('click', event => {
    const action = event.target.closest('[data-action]');
    if (action?.dataset.action === 'remove') removeFromBasket(action.dataset.id);
    if (action?.dataset.action === 'add') addToBasket(action.dataset.id);
  });

  document.getElementById('basketFooter').addEventListener('click', event => {
    if (!event.target.closest('[data-action="checkout"]')) return;
    closeBasket(false);
    openCheckout(document.getElementById('basketBtn'));
  });

  document.getElementById('basketBtn').addEventListener('click', openBasket);
  document.getElementById('closeBasketBtn').addEventListener('click', () => closeBasket());
  document.getElementById('basketOverlay').addEventListener('click', () => closeBasket());
  document.getElementById('closeCheckoutBtn').addEventListener('click', () => closeCheckout());
  document.getElementById('checkoutOverlay').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeCheckout();
  });
  PHONE_ORDER_ACTION_MEDIA.addEventListener('change', updateOrderActionUi);
  document.getElementById('fieldLevering').addEventListener('change', updateCheckoutSummary);

  ['fieldNavn', 'fieldEmail', 'fieldMobil'].forEach(id => {
    document.getElementById(id).addEventListener('input', event => {
      const errorId = event.target.getAttribute('aria-describedby');
      setFieldError(event.target, document.getElementById(errorId), '');
    });
  });

  document.getElementById('checkoutForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!validateCheckoutForm()) return;

    const name = document.getElementById('fieldNavn').value.trim();
    const email = document.getElementById('fieldEmail').value.trim();
    const phone = document.getElementById('fieldMobil').value.trim();
    const delivery = document.getElementById('fieldLevering').value;
    const message = document.getElementById('fieldBesked').value.trim();

    document.getElementById('orderText').value = generateOrderText(name, email, phone, delivery, message);
    event.currentTarget.style.display = 'none';
    document.getElementById('orderResult').style.display = '';
    updateOrderActionUi().focus();
  });

  document.getElementById('orderActionBtn').addEventListener('click', () => copyOrderText());
  document.getElementById('copyOrderBtn').addEventListener('click', () => copyOrderText());
  document.getElementById('clearBasketBtn').addEventListener('click', () => {
    clearBasket();
    document.getElementById('orderText').value = '';
    closeCheckout();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (document.getElementById('filterRow').classList.contains('open')) closeFilterPanel({ restoreFocus: true });
      else if (document.getElementById('checkoutOverlay').classList.contains('open')) closeCheckout();
      else if (document.getElementById('basketSidebar').classList.contains('open')) closeBasket();
    }
    trapFocus(event);
  });
}

document.addEventListener('DOMContentLoaded', init);
