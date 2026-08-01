/* app.js — Pladesamling vinyl shop */

// =============================================
// Constants
// =============================================
const BASELINE_DISCOUNT = 0.15;
const VOLUME_TIERS = [
  { min: 20, discount: 0.225 },
  { min: 10, discount: 0.15  },
  { min: 5,  discount: 0.10  },
  { min: 1,  discount: 0     }
];
const PAGE_SIZE = 48;
const ORDER_EMAIL = 'mellemvej12@gmail.com';

// =============================================
// State
// =============================================
let allVinyls      = [];
let filteredVinyls = [];
let basket         = [];
let displayCount   = PAGE_SIZE;

// =============================================
// Utility
// =============================================
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatPrice(n) {
  if (n == null || isNaN(n)) return '—';
  return Math.round(n).toLocaleString('da-DK') + ' kr';
}

function getDisplayPrice(discogsPrice) {
  return Math.round(discogsPrice * (1 - BASELINE_DISCOUNT));
}

function getVolumeDiscount(count) {
  for (const tier of VOLUME_TIERS) {
    if (count >= tier.min) return tier.discount;
  }
  return 0;
}

function getNextTier(count) {
  // Return the next tier that the user hasn't yet reached
  const tiers = [...VOLUME_TIERS].reverse(); // ascending min
  for (const tier of tiers) {
    if (tier.min > count && tier.discount > 0) {
      return { needed: tier.min - count, discount: tier.discount };
    }
  }
  return null;
}

// =============================================
// Init
// =============================================
async function init() {
  loadBasket();

  try {
    const resp = await fetch('data/vinyls.json');
    if (!resp.ok) throw new Error('Kunne ikke hente katalog');
    const raw = await resp.json();
    // Filter out sold items
    allVinyls = raw.filter(v => !v.sold);
  } catch (e) {
    console.warn('Could not load vinyls.json, using empty dataset.', e);
    allVinyls = [];
  }

  populateFilters();
  filterAndSort();
  updateBasketUI();
  bindEvents();
}

// =============================================
// Filters
// =============================================
function getGenres(v) {
  if (!v.genres) return [];
  return String(v.genres).split(',').map(g => g.trim()).filter(Boolean);
}

function populateFilters() {
  const genres    = new Set();
  const countries = new Set();
  const decades   = new Set();

  for (const v of allVinyls) {
    for (const g of getGenres(v)) genres.add(g);
    if (v.country) countries.add(v.country.trim());
    if (v.released) {
      const decade = Math.floor(Number(v.released) / 10) * 10;
      if (!isNaN(decade)) decades.add(decade);
    }
  }

  fillSelect('genreFilter',   [...genres].sort(),    v => v, v => v);
  fillSelect('countryFilter', [...countries].sort(), v => v, v => v);
  fillSelect('decadeFilter',
    [...decades].sort((a, b) => a - b),
    d => `${d}'erne`,
    d => String(d)
  );
}

function fillSelect(id, items, labelFn, valueFn) {
  const sel = document.getElementById(id);
  const first = sel.options[0]; // keep "Alle …"
  sel.innerHTML = '';
  sel.appendChild(first);
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = valueFn(item);
    opt.textContent = labelFn(item);
    sel.appendChild(opt);
  }
}

// =============================================
// Filter & Sort
// =============================================
function filterAndSort() {
  const query   = document.getElementById('searchInput').value.toLowerCase().trim();
  const genre   = document.getElementById('genreFilter').value;
  const country = document.getElementById('countryFilter').value;
  const decade  = document.getElementById('decadeFilter').value;
  const sort    = document.getElementById('sortSelect').value;

  let result = allVinyls.filter(v => {
    // Text search
    if (query) {
      const artist = (v.artist || '').toLowerCase();
      const title  = (v.albumTitle || '').toLowerCase();
      const genres = getGenres(v).join(' ').toLowerCase();
      if (!artist.includes(query) && !title.includes(query) && !genres.includes(query)) {
        return false;
      }
    }
    // Genre
    if (genre && !getGenres(v).includes(genre)) return false;
    // Country
    if (country && (v.country || '').trim() !== country) return false;
    // Decade
    if (decade) {
      const d = Math.floor(Number(v.released) / 10) * 10;
      if (String(d) !== decade) return false;
    }

    return true;
  });

  // Sort
  result = result.slice(); // copy
  switch (sort) {
    case 'artist-az':
      result.sort((a, b) => (a.artist || '').localeCompare(b.artist || '', 'da'));
      break;
    case 'price-asc':
      result.sort((a, b) => (a.discogsPrice || 0) - (b.discogsPrice || 0));
      break;
    case 'price-desc':
      result.sort((a, b) => (b.discogsPrice || 0) - (a.discogsPrice || 0));
      break;
    case 'year-asc':
      result.sort((a, b) => {
        const ya = a.released || 9999, yb = b.released || 9999;
        return ya - yb;
      });
      break;
    case 'year-desc':
      result.sort((a, b) => {
        const ya = a.released || 0, yb = b.released || 0;
        return yb - ya;
      });
      break;
  }

  filteredVinyls = result;
  displayCount   = PAGE_SIZE;
  renderCatalogue();
}

// =============================================
// Render Catalogue
// =============================================
function renderCatalogue() {
  const grid = document.getElementById('vinylGrid');
  const countEl = document.getElementById('resultCount');
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  const slice = filteredVinyls.slice(0, displayCount);

  if (filteredVinyls.length === 0) {
    grid.innerHTML = '<div class="empty-state"><h3>Ingen plader fundet</h3><p>Prøv at justere dine søgekriterier.</p></div>';
    countEl.textContent = '0 plader';
    loadMoreBtn.style.display = 'none';
    return;
  }

  countEl.textContent = filteredVinyls.length.toLocaleString('da-DK') + ' plader';
  grid.innerHTML = slice.map(v => renderCard(v)).join('');

  if (displayCount < filteredVinyls.length) {
    loadMoreBtn.style.display = 'inline-flex';
    loadMoreBtn.textContent = `Vis flere (${Math.min(PAGE_SIZE, filteredVinyls.length - displayCount)} mere)`;
  } else {
    loadMoreBtn.style.display = 'none';
  }
}

function renderCard(v) {
  const id           = escapeHtml(v.id);
  const artist       = escapeHtml(v.artist || 'Ukendt kunstner');
  const title        = escapeHtml(v.albumTitle || 'Ukendt album');
  const year         = escapeHtml(String(v.released || ''));
  const country      = escapeHtml(v.country || '');
  const catno        = escapeHtml(v.catNo || '');
  const shelf        = escapeHtml(String(v.shelf || ''));
  const genres       = getGenres(v);
  const genreDisplay = genres.map(g => `<span class="card-genre">${escapeHtml(g)}</span>`).join('');
  const displayPrice = getDisplayPrice(v.discogsPrice || 0);
  const inBasket     = basket.includes(v.id);

  const meta = [year, country].filter(Boolean).join(' · ');

  const cardClass = inBasket ? 'vinyl-card in-basket' : 'vinyl-card';
  const btnClass  = inBasket ? 'btn-primary in-basket' : 'btn-primary';
  const btnText   = inBasket ? 'I kurven ✓' : 'Læg i kurv';
  const btnDisabled = inBasket ? 'disabled' : '';
  const btnAction = inBasket
    ? ''
    : `onclick="addToBasket('${id}')"`;

  return `
<div class="${cardClass}" data-id="${id}">
  <div class="card-artist">${artist}</div>
  <div class="card-title">${title}</div>
  ${meta ? `<div class="card-meta">${meta}</div>` : ''}
  ${genreDisplay ? `<div class="card-genres">${genreDisplay}</div>` : ''}
  ${catno ? `<div class="card-catno">${catno}</div>` : ''}
  <div class="card-footer">
    ${shelf ? `<span class="card-shelf">Hylde ${shelf}</span>` : '<span></span>'}
    <span class="card-price">${formatPrice(displayPrice)}</span>
    <button class="${btnClass}" ${btnAction} ${btnDisabled}>${btnText}</button>
  </div>
</div>`.trim();
}

// =============================================
// Basket
// =============================================
function loadBasket() {
  try {
    const stored = localStorage.getItem('pladesamling_basket');
    basket = stored ? JSON.parse(stored) : [];
  } catch {
    basket = [];
  }
}

function saveBasket() {
  try {
    localStorage.setItem('pladesamling_basket', JSON.stringify(basket));
  } catch {}
}

function addToBasket(id) {
  id = Number(id);
  if (!basket.includes(id)) {
    basket.push(id);
    saveBasket();
    updateBasketUI();
    renderCatalogue();
  }
}

function removeFromBasket(id) {
  id = Number(id);
  basket = basket.filter(b => b !== id);
  saveBasket();
  updateBasketUI();
  renderCatalogue();
}

// =============================================
// Basket UI
// =============================================
function updateBasketUI() {
  const count = basket.length;
  document.getElementById('basketCount').textContent = count;

  const body   = document.getElementById('basketBody');
  const footer = document.getElementById('basketFooter');

  if (count === 0) {
    body.innerHTML   = '<p class="basket-empty">Din kurv er tom</p>';
    footer.innerHTML = '';
    return;
  }

  // Resolve basket items
  const items = basket
    .map(id => allVinyls.find(v => v.id === id))
    .filter(Boolean);

  // Items HTML
  body.innerHTML = items.map(v => {
    const dp = getDisplayPrice(v.discogsPrice || 0);
    return `
<div class="basket-item">
  <div class="basket-item-info">
    <div class="basket-item-artist">${escapeHtml(v.artist || '')}</div>
    <div class="basket-item-title">${escapeHtml(v.albumTitle || '')}</div>
    <div class="basket-item-price">${formatPrice(dp)}</div>
  </div>
  <button class="basket-remove" onclick="removeFromBasket('${escapeHtml(v.id)}')" aria-label="Fjern ${escapeHtml(v.artist || '')} fra kurv">×</button>
</div>`.trim();
  }).join('');

  // Pricing
  const discogsTotal  = items.reduce((s, v) => s + (v.discogsPrice || 0), 0);
  const baseDiscount  = discogsTotal * BASELINE_DISCOUNT;
  const volumeDisc    = getVolumeDiscount(count);
  const afterBase     = discogsTotal - baseDiscount;
  const volumeAmount  = afterBase * volumeDisc;
  const total         = afterBase - volumeAmount;
  const nextTier      = getNextTier(count);

  let footerHtml = '';

  if (volumeDisc > 0) {
    footerHtml += `<p class="discount-active">${formatDiscountPct(volumeDisc)} mængderabat aktiveret</p>`;
  }
  if (nextTier) {
    footerHtml += `<p class="discount-hint">Tilføj ${nextTier.needed} mere for ${formatDiscountPct(nextTier.discount)} rabat</p>`;
  }

  footerHtml += `<div class="price-breakdown">
  <div class="price-row"><span>Discogs-pris i alt</span><span>${formatPrice(discogsTotal)}</span></div>
  <div class="price-row"><span>Basisrabat (−15%)</span><span>−${formatPrice(baseDiscount)}</span></div>
  ${volumeDisc > 0 ? `<div class="price-row"><span>Mængderabat (${formatDiscountPct(volumeDisc)})</span><span>−${formatPrice(volumeAmount)}</span></div>` : ''}
  <div class="price-row total"><span>Total</span><span>${formatPrice(total)}</span></div>
</div>`;

  footerHtml += `<button class="btn-primary btn-full" id="checkoutBtn">Gå til bestilling</button>`;

  footer.innerHTML = footerHtml;

  document.getElementById('checkoutBtn').addEventListener('click', () => {
    closeBasket();
    openCheckout();
  });
}

function formatDiscountPct(d) {
  return (d * 100).toLocaleString('da-DK', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + '%';
}

// =============================================
// Basket Sidebar open/close
// =============================================
function openBasket() {
  document.getElementById('basketSidebar').classList.add('open');
  document.getElementById('basketSidebar').setAttribute('aria-hidden', 'false');
  document.getElementById('basketOverlay').classList.add('active');
  document.getElementById('basketOverlay').setAttribute('aria-hidden', 'false');
}

function closeBasket() {
  document.getElementById('basketSidebar').classList.remove('open');
  document.getElementById('basketSidebar').setAttribute('aria-hidden', 'true');
  document.getElementById('basketOverlay').classList.remove('active');
  document.getElementById('basketOverlay').setAttribute('aria-hidden', 'true');
}

// =============================================
// Checkout Modal
// =============================================
function openCheckout() {
  document.getElementById('checkoutOverlay').classList.add('open');
  document.getElementById('checkoutOverlay').setAttribute('aria-hidden', 'false');
  document.getElementById('checkoutForm').style.display = '';
  document.getElementById('orderResult').style.display = 'none';
  document.getElementById('checkoutForm').reset();
}

function closeCheckout() {
  document.getElementById('checkoutOverlay').classList.remove('open');
  document.getElementById('checkoutOverlay').setAttribute('aria-hidden', 'true');
}

// =============================================
// Order generation
// =============================================
function generateOrderText(name, email, phone, delivery) {
  const items = basket
    .map(id => allVinyls.find(v => v.id === id))
    .filter(Boolean);

  const discogsTotal = items.reduce((s, v) => s + (v.discogsPrice || 0), 0);
  const baseDiscount = discogsTotal * BASELINE_DISCOUNT;
  const volumeDisc   = getVolumeDiscount(items.length);
  const afterBase    = discogsTotal - baseDiscount;
  const volumeAmount = afterBase * volumeDisc;
  const total        = afterBase - volumeAmount;

  const itemLines = items.map(v => {
    const dp = getDisplayPrice(v.discogsPrice || 0);
    const shelf = v.shelf || '?';
    return `  ${v.artist || '?'} — ${v.albumTitle || '?'}\n    Hylde ${shelf} · Discogs-pris ${formatPrice(v.discogsPrice || 0)} → ${formatPrice(dp)}`;
  }).join('\n\n');

  const volumeLine = volumeDisc > 0
    ? `Mængderabat (${formatDiscountPct(volumeDisc)}):   −${formatPrice(volumeAmount)}`
    : null;

  const sep = '────────────────────────────';

  const lines = [
    `Emne: Ny bestilling fra ${name} — ${items.length} plader, ${formatPrice(total)}`,
    '',
    'Hej',
    '',
    'Jeg vil gerne bestille følgende plader fra jeres samling:',
    '',
    itemLines,
    '',
    sep,
    `Discogs-pris i alt:    ${formatPrice(discogsTotal)}`,
    `Basisrabat (−15%):    −${formatPrice(baseDiscount)}`,
    ...(volumeLine ? [volumeLine] : []),
    `Total:                 ${formatPrice(total)}`,
    sep,
    '',
    `Levering: ${delivery}`,
    '',
    'Mine kontaktoplysninger:',
    `  Navn: ${name}`,
    `  Email: ${email}`,
    `  Mobil: ${phone}`,
    '',
    '',
    'Mvh',
    name
  ];

  return lines.join('\n');
}

// =============================================
// Reset filters
// =============================================
function resetFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('genreFilter').value = '';
  document.getElementById('countryFilter').value = '';
  document.getElementById('decadeFilter').value = '';
  document.getElementById('sortSelect').value = 'artist-az';
  filterAndSort();
}

// =============================================
// Event listeners
// =============================================
function bindEvents() {
  // Search & filters
  document.getElementById('searchInput').addEventListener('input', filterAndSort);
  document.getElementById('genreFilter').addEventListener('change', filterAndSort);
  document.getElementById('countryFilter').addEventListener('change', filterAndSort);
  document.getElementById('decadeFilter').addEventListener('change', filterAndSort);
  document.getElementById('minPrice').addEventListener('input', filterAndSort);
  document.getElementById('maxPrice').addEventListener('input', filterAndSort);
  document.getElementById('sortSelect').addEventListener('change', filterAndSort);

  // Reset filters
  document.getElementById('resetFiltersBtn').addEventListener('click', resetFilters);

  // Load more
  document.getElementById('loadMoreBtn').addEventListener('click', () => {
    displayCount += PAGE_SIZE;
    renderCatalogue();
  });

  // Basket open/close
  document.getElementById('basketBtn').addEventListener('click', openBasket);
  document.getElementById('closeBasketBtn').addEventListener('click', closeBasket);
  document.getElementById('basketOverlay').addEventListener('click', closeBasket);

  // Checkout open/close
  document.getElementById('closeCheckoutBtn').addEventListener('click', closeCheckout);
  document.getElementById('checkoutOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('checkoutOverlay')) closeCheckout();
  });

  // Checkout form submit
  document.getElementById('checkoutForm').addEventListener('submit', e => {
    e.preventDefault();
    const form     = e.target;
    const name     = form.fieldNavn.value.trim();
    const email    = form.fieldEmail.value.trim();
    const phone    = form.fieldMobil.value.trim();
    const delivery = form.fieldLevering.value;

    // Basic validation
    let valid = true;
    [form.fieldNavn, form.fieldEmail, form.fieldMobil].forEach(f => {
      if (!f.value.trim()) {
        f.classList.add('invalid');
        valid = false;
      } else {
        f.classList.remove('invalid');
      }
    });
    if (!valid) return;

    const text = generateOrderText(name, email, phone, delivery);
    document.getElementById('orderText').value = text;
    form.style.display = 'none';
    document.getElementById('orderResult').style.display = '';

    // Clear basket after order
    basket = [];
    saveBasket();
    updateBasketUI();
    renderCatalogue();
  });

  // Copy button
  document.getElementById('copyBtn').addEventListener('click', async () => {
    const text = document.getElementById('orderText').value;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback
      document.getElementById('orderText').select();
      document.execCommand('copy');
    }
    const confirm = document.getElementById('copyConfirm');
    confirm.style.display = 'block';
    setTimeout(() => { confirm.style.display = 'none'; }, 2000);
  });

  // Keyboard: Escape closes modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeBasket();
      closeCheckout();
    }
  });
}

// =============================================
// Bootstrap
// =============================================
document.addEventListener('DOMContentLoaded', init);



