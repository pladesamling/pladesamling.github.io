/* app.js — Pladesamling vinyl shop */

// =============================================
// Constants
// =============================================
const BASELINE_DISCOUNT = 0.15;
const VOLUME_TIERS = [
  { min: 20, discount: 0.225 },
  { min: 10, discount: 0.15 },
  { min: 5, discount: 0.10 },
  { min: 1, discount: 0 }
];
const PAGE_SIZE = 48;
const ORDER_EMAIL = 'mellemvej12@gmail.com';
const BASKET_STORAGE_KEY = 'pladesamling_basket';
const COMBINED_COUNTRY_GENRE = 'Folk, World, & Country';
const VALID_STATUSES = new Set(['available', 'reserved', 'sold']);

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

function getDisplayPriceOre(discogsPrice) {
  const discountedOre = priceToOre(discogsPrice) * (1 - BASELINE_DISCOUNT);
  // Cards show whole kroner, so every item is rounded before basket totals are added.
  return Math.round(discountedOre / 100) * 100;
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

function calculateOrder(items) {
  const discogsTotalOre = items.reduce((sum, vinyl) => sum + priceToOre(vinyl.discogsPrice), 0);
  const baseSubtotalOre = items.reduce((sum, vinyl) => sum + getDisplayPriceOre(vinyl.discogsPrice), 0);
  const baseDiscountOre = discogsTotalOre - baseSubtotalOre;
  const volumeDiscount = getVolumeDiscount(items.length);
  const volumeAmountOre = Math.round(baseSubtotalOre * volumeDiscount);

  return {
    discogsTotalOre,
    baseSubtotalOre,
    baseDiscountOre,
    volumeDiscount,
    volumeAmountOre,
    totalOre: baseSubtotalOre - volumeAmountOre
  };
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
    }
    allVinyls = raw.filter(vinyl => getVinylStatus(vinyl) === 'available');
    vinylById = new Map(allVinyls.map(vinyl => [Number(vinyl.id), vinyl]));
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
  document.getElementById('yearRange').textContent = yearRange;
  document.getElementById('heroYearRange').textContent = yearRange;
}

// =============================================
// Filters and sorting
// =============================================
function populateFilters() {
  const genres = new Set();
  const countries = new Set();
  const decades = new Set();

  for (const vinyl of allVinyls) {
    getGenres(vinyl).forEach(genre => genres.add(genre));
    countries.add(normalizeCountry(vinyl.country));

    const year = Number(vinyl.released);
    if (Number.isFinite(year) && year > 0) decades.add(Math.floor(year / 10) * 10);
  }

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
  const genre = document.getElementById('genreFilter').value;
  const country = document.getElementById('countryFilter').value;
  const decade = document.getElementById('decadeFilter').value;
  const sort = document.getElementById('sortSelect').value;

  const activeFilterCount = [genre, country, decade].filter(Boolean).length;
  const filterToggle = document.getElementById('filterToggleBtn');
  filterToggle.textContent = activeFilterCount ? `Filtre (${activeFilterCount})` : 'Filtre';

  filteredVinyls = allVinyls.filter(vinyl => {
    if (query) {
      const searchable = [vinyl.artist, vinyl.albumTitle, vinyl.catNo, ...getGenres(vinyl)]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('da-DK');
      if (!searchable.includes(query)) return false;
    }

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
      filteredVinyls.sort((a, b) => getDisplayPriceOre(a.discogsPrice) - getDisplayPriceOre(b.discogsPrice) || byArtistThenTitle(a, b));
      break;
    case 'price-desc':
      filteredVinyls.sort((a, b) => getDisplayPriceOre(b.discogsPrice) - getDisplayPriceOre(a.discogsPrice) || byArtistThenTitle(a, b));
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
  document.getElementById('genreFilter').value = '';
  document.getElementById('countryFilter').value = '';
  document.getElementById('decadeFilter').value = '';
  document.getElementById('sortSelect').value = 'artist-az';
  document.getElementById('filterRow').classList.remove('open');
  document.getElementById('filterToggleBtn').setAttribute('aria-expanded', 'false');
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
  const genreDisplay = genres.map(value => `<span class="card-genre">${escapeHtml(value)}</span>`).join('');
  const displayPriceOre = getDisplayPriceOre(vinyl.discogsPrice);
  const inBasket = basket.includes(id);
  const meta = [year, country].filter(Boolean).join(' · ');

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
    <div><span>Pladenummer</span><strong>#${id}</strong></div>
    <div><span>Katalognummer</span><strong>${catNo || '—'}</strong></div>
  </div>
  <div class="card-footer">
    <span class="card-price-wrap">
      <span class="card-price-label">Efter 15% rabat</span>
      <span class="card-price">${formatPriceOre(displayPriceOre)}</span>
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

function updateBasketUI() {
  const items = resolveBasketItems();
  const count = items.length;
  document.getElementById('basketCount').textContent = count;

  const body = document.getElementById('basketBody');
  const footer = document.getElementById('basketFooter');

  if (count === 0) {
    body.innerHTML = '<p class="basket-empty">Din kurv er tom</p>';
    footer.innerHTML = '';
    return;
  }

  body.innerHTML = items.map(vinyl => `
<div class="basket-item">
  <div class="basket-item-info">
    <div class="basket-item-artist">${escapeHtml(vinyl.artist || '')}</div>
    <div class="basket-item-title">${escapeHtml(vinyl.albumTitle || '')}</div>
    <div class="basket-item-price">${formatPriceOre(getDisplayPriceOre(vinyl.discogsPrice))}</div>
  </div>
  <button class="basket-remove" type="button" data-action="remove" data-id="${Number(vinyl.id)}" aria-label="Fjern ${escapeHtml(vinyl.artist || '')} – ${escapeHtml(vinyl.albumTitle || '')} fra kurven">×</button>
</div>`.trim()).join('');

  const totals = calculateOrder(items);
  const nextTier = getNextTier(count);
  let footerHtml = '';

  if (totals.volumeDiscount > 0) {
    footerHtml += `<p class="discount-active">${formatDiscountPct(totals.volumeDiscount)} mængderabat aktiveret</p>`;
  }
  if (nextTier) {
    footerHtml += `<p class="discount-hint">Tilføj ${nextTier.needed} ${nextTier.needed === 1 ? 'plade' : 'plader'} mere for ${formatDiscountPct(nextTier.discount)} rabat</p>`;
  }

  footerHtml += `<div class="price-breakdown">
  <div class="price-row"><span>Discogs-pris i alt</span><span>${formatPriceOre(totals.discogsTotalOre)}</span></div>
  <div class="price-row"><span>Basisrabat (−15%)</span><span>−${formatPriceOre(totals.baseDiscountOre)}</span></div>
  ${totals.volumeDiscount > 0 ? `<div class="price-row"><span>Mængderabat (${formatDiscountPct(totals.volumeDiscount)})</span><span>−${formatPriceOre(totals.volumeAmountOre)}</span></div>` : ''}
  <div class="price-row total"><span>Total</span><span>${formatPriceOre(totals.totalOre)}</span></div>
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
  const items = resolveBasketItems();
  const totals = calculateOrder(items);
  document.getElementById('checkoutSummary').textContent = `${formatRecordCount(items.length)} · Total ${formatPriceOre(totals.totalOre)}`;
  syncBodyScrollLock();
  document.getElementById('closeCheckoutBtn').focus();
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
  const totals = calculateOrder(items);

  const itemLines = items.map(vinyl => {
    const details = [
      vinyl.released || null,
      normalizeCountry(vinyl.country),
      vinyl.catNo ? `Kat.nr. ${vinyl.catNo}` : null,
      vinyl.shelf != null && vinyl.shelf !== '' ? `Hylde ${vinyl.shelf}` : null
    ].filter(Boolean).join(' · ');

    return `  #${vinyl.id} · ${vinyl.artist || '?'} — ${vinyl.albumTitle || '?'}\n    ${details}\n    Discogs-pris ${formatPriceOre(priceToOre(vinyl.discogsPrice))} → ${formatPriceOre(getDisplayPriceOre(vinyl.discogsPrice))}`;
  }).join('\n\n');

  const volumeLine = totals.volumeDiscount > 0
    ? `Mængderabat (${formatDiscountPct(totals.volumeDiscount)}):   −${formatPriceOre(totals.volumeAmountOre)}`
    : null;
  const separator = '────────────────────────────';

  const lines = [
    `Emne: Ny bestilling fra ${name} — ${formatRecordCount(items.length)}, ${formatPriceOre(totals.totalOre)}`,
    '',
    'Hej',
    '',
    'Jeg vil gerne bestille følgende plader fra jeres samling:',
    '',
    itemLines,
    '',
    separator,
    `Discogs-pris i alt:    ${formatPriceOre(totals.discogsTotalOre)}`,
    `Basisrabat (−15%):    −${formatPriceOre(totals.baseDiscountOre)}`,
    ...(volumeLine ? [volumeLine] : []),
    `Total:                 ${formatPriceOre(totals.totalOre)}`,
    separator,
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

async function copyOrderText() {
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
  confirmation.textContent = copied ? '✓ Kopieret!' : 'Kopiering mislykkedes – markér teksten og kopiér manuelt.';
  confirmation.hidden = false;
  if (copied) window.setTimeout(() => { confirmation.hidden = true; }, 2500);
}

// =============================================
// Events
// =============================================
function bindEvents() {
  document.getElementById('searchInput').addEventListener('input', filterAndSort);
  document.getElementById('genreFilter').addEventListener('change', filterAndSort);
  document.getElementById('countryFilter').addEventListener('change', filterAndSort);
  document.getElementById('decadeFilter').addEventListener('change', filterAndSort);
  document.getElementById('sortSelect').addEventListener('change', filterAndSort);
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
    const action = event.target.closest('[data-action="remove"]');
    if (action) removeFromBasket(action.dataset.id);
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
    document.getElementById('copyBtn').focus();
  });

  document.getElementById('copyBtn').addEventListener('click', copyOrderText);
  document.getElementById('clearBasketBtn').addEventListener('click', () => {
    clearBasket();
    document.getElementById('orderText').value = '';
    closeCheckout();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (document.getElementById('checkoutOverlay').classList.contains('open')) closeCheckout();
      else if (document.getElementById('basketSidebar').classList.contains('open')) closeBasket();
    }
    trapFocus(event);
  });
}

document.addEventListener('DOMContentLoaded', init);
