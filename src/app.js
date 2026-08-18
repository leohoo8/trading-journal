import {
  CONTRACT_TYPES, WEEKDAYS, dayOfWeek, categorizeTime, calculateDTE,
  normalizeTicker, formatDate, formatTime, groupCounts, normalizeExits, exitedQuantity,
  weightedAverageExit, calculateRealizedPnL
} from './domain.js';
import {
  getTrades, saveTrade, deleteTrade, getSetups, saveSetups, getTimeRules, saveTimeRules,
  getCloudConfig, saveCloudConfig, clearCloudConfig, testCloudConnection, getSession,
  signUp, signIn, signOut, getLocalMigrationSummary, migrateLocalDataToCloud, wasLocalDataMigrated
} from './storage.js';
import { escapeHtml, barChart, toast } from './ui.js';

const view = document.querySelector('#view');
const pageTitle = document.querySelector('#pageTitle');
const pageSubtitle = document.querySelector('#pageSubtitle');
const modal = document.querySelector('#modal');
const modalBody = document.querySelector('#modalBody');
const modalTitle = document.querySelector('#modalTitle');
const sidebar = document.querySelector('#sidebar');

let currentRoute = 'dashboard';
let tradeSort = 'desc';
let appReady = false;
let currentSession = null;

const routeMeta = {
  dashboard: ['Dashboard', 'Your trading activity at a glance.'],
  add: ['Add Trade', 'Record a trade in seconds with structured fields.'],
  journal: ['Trade Journal', 'Search, filter, and review every recorded trade.'],
  analytics: ['Analytics', 'Explore patterns in your trading behavior.'],
};

document.querySelectorAll('.nav-link').forEach(btn => btn.addEventListener('click', () => { if (appReady) navigate(btn.dataset.route); }));
document.querySelector('#quickAdd').addEventListener('click', () => { if (appReady) navigate('add'); });
document.querySelector('#mobileMenu').addEventListener('click', () => sidebar.classList.toggle('open'));
document.querySelectorAll('[data-close-modal]').forEach(el => el.addEventListener('click', closeModal));

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

const cloudStatus = document.querySelector('#cloudStatus');
const cloudAccount = document.querySelector('#cloudAccount');
const cloudSettingsButton = document.querySelector('#cloudSettings');
const signOutButton = document.querySelector('#signOutButton');
cloudSettingsButton?.addEventListener('click', () => renderCloudSetup());
signOutButton?.addEventListener('click', async () => {
  try {
    await signOut();
    currentSession = null;
    appReady = false;
    setChromeEnabled(false);
    renderAuth();
  } catch (error) {
    toast(error.message || 'Could not sign out');
  }
});

function setChromeEnabled(enabled) {
  appReady = enabled;
  document.querySelectorAll('.nav-link').forEach(btn => btn.disabled = !enabled);
  document.querySelector('#quickAdd').classList.toggle('hidden', !enabled);
  if (signOutButton) signOutButton.classList.toggle('hidden', !enabled);
}

function setCloudStatus(label, account = '') {
  if (cloudStatus) cloudStatus.textContent = label;
  if (cloudAccount) cloudAccount.textContent = account;
}

function renderCloudSetup() {
  setChromeEnabled(false);
  pageTitle.textContent = 'Cloud Setup';
  pageSubtitle.textContent = 'Connect this journal to your private Supabase project.';
  const config = getCloudConfig() || {};
  setCloudStatus('Cloud setup required');
  view.innerHTML = `
    <div class="onboarding-shell">
      <div class="card onboarding-card">
        <div class="card-header"><div><h2>Connect automatic cloud sync</h2><p class="card-subtitle">Do this once on each computer. Your trades will then sync through the same account.</p></div></div>
        <div class="setup-steps">
          <div><strong>1</strong><span>Create a free Supabase project.</span></div>
          <div><strong>2</strong><span>Open Supabase SQL Editor and run the included <code>supabase-schema.sql</code> file once.</span></div>
          <div><strong>3</strong><span>In Supabase, copy your Project URL and <em>publishable</em> key. Never paste a secret/service-role key here.</span></div>
          <div><strong>4</strong><span>Paste both values below and connect.</span></div>
        </div>
        <form id="cloudConfigForm" class="grid" style="margin-top:20px">
          <div class="field"><label for="supabaseUrl">Supabase Project URL</label><input id="supabaseUrl" type="url" required placeholder="https://xxxxx.supabase.co" value="${escapeHtml(config.url || '')}"></div>
          <div class="field"><label for="supabaseKey">Supabase Publishable Key</label><input id="supabaseKey" type="password" required placeholder="sb_publishable_..." value="${escapeHtml(config.key || '')}"><div class="helper">The publishable key is intended for browser apps. Security is enforced by the database Row Level Security policies in the included SQL file.</div></div>
          <div class="inline-actions"><button class="primary-button" type="submit">Save & Connect</button>${config.url ? '<button class="danger-button" id="forgetCloud" type="button">Forget Cloud Config</button>' : ''}</div>
        </form>
      </div>
    </div>`;
  document.querySelector('#cloudConfigForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Connecting…';
    try {
      saveCloudConfig({
        url: document.querySelector('#supabaseUrl').value,
        key: document.querySelector('#supabaseKey').value,
      });
      await testCloudConnection();
      toast('Cloud connection saved');
      await boot();
    } catch (error) {
      console.error(error);
      toast(error.message || 'Could not connect');
      submit.disabled = false;
      submit.textContent = 'Save & Connect';
    }
  });
  document.querySelector('#forgetCloud')?.addEventListener('click', () => {
    if (!confirm('Forget the Supabase connection on this computer? Cloud data will not be deleted.')) return;
    clearCloudConfig();
    renderCloudSetup();
  });
}

function renderAuth(message = '') {
  setChromeEnabled(false);
  pageTitle.textContent = 'Sign In';
  pageSubtitle.textContent = 'Use the same account on every computer.';
  setCloudStatus('Cloud connected · Sign in');
  view.innerHTML = `
    <div class="onboarding-shell">
      <div class="card onboarding-card auth-card">
        <div class="cloud-icon">☁</div>
        <h2>Trading Journal Cloud</h2>
        <p class="card-subtitle">Sign in to load your trades, setups, settings, and screenshots from the cloud.</p>
        ${message ? `<div class="notice">${escapeHtml(message)}</div>` : ''}
        <form id="authForm" class="grid" style="margin-top:20px">
          <div class="field"><label for="authEmail">Email</label><input id="authEmail" type="email" autocomplete="email" required></div>
          <div class="field"><label for="authPassword">Password</label><input id="authPassword" type="password" minlength="6" autocomplete="current-password" required></div>
          <div class="auth-actions"><button class="primary-button" id="signInAction" type="submit">Sign In</button><button class="secondary-button" id="signUpAction" type="button">Create Account</button></div>
          <button class="ghost-button" id="changeCloud" type="button">Change Cloud Connection</button>
        </form>
      </div>
    </div>`;

  const form = document.querySelector('#authForm');
  const email = document.querySelector('#authEmail');
  const password = document.querySelector('#authPassword');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.querySelector('#signInAction');
    button.disabled = true; button.textContent = 'Signing in…';
    try {
      const data = await signIn(email.value.trim(), password.value);
      currentSession = data.session;
      await startJournal();
    } catch (error) {
      toast(error.message || 'Could not sign in');
      button.disabled = false; button.textContent = 'Sign In';
    }
  });
  document.querySelector('#signUpAction').addEventListener('click', async () => {
    if (!email.reportValidity() || !password.reportValidity()) return;
    const button = document.querySelector('#signUpAction');
    button.disabled = true; button.textContent = 'Creating…';
    try {
      const data = await signUp(email.value.trim(), password.value);
      if (data.session) { currentSession = data.session; await startJournal(); }
      else renderAuth('Account created. Check your email for the Supabase confirmation link, then come back and sign in.');
    } catch (error) {
      toast(error.message || 'Could not create account');
      button.disabled = false; button.textContent = 'Create Account';
    }
  });
  document.querySelector('#changeCloud').addEventListener('click', renderCloudSetup);
}

async function startJournal() {
  if (!currentSession) currentSession = await getSession();
  if (!currentSession) return renderAuth();
  setChromeEnabled(true);
  setCloudStatus('Cloud synced', currentSession.user.email || 'Signed in');
  await navigate('dashboard');
}

async function boot() {
  const config = getCloudConfig();
  if (!config) return renderCloudSetup();
  setCloudStatus('Connecting to cloud…');
  try {
    await testCloudConnection();
    currentSession = await getSession();
    if (!currentSession) return renderAuth();
    await startJournal();
  } catch (error) {
    console.error(error);
    setChromeEnabled(false);
    pageTitle.textContent = 'Cloud Connection Error';
    pageSubtitle.textContent = 'Your journal files are safe; the cloud connection needs attention.';
    view.innerHTML = `<div class="onboarding-shell"><div class="card onboarding-card"><h2>Could not connect</h2><p class="helper">${escapeHtml(error.message || String(error))}</p><div class="inline-actions" style="margin-top:16px"><button class="primary-button" id="retryCloud">Retry</button><button class="secondary-button" id="editCloud">Edit Cloud Settings</button></div></div></div>`;
    document.querySelector('#retryCloud').addEventListener('click', boot);
    document.querySelector('#editCloud').addEventListener('click', renderCloudSetup);
  }
}

async function navigate(route) {
  currentRoute = route;
  sidebar.classList.remove('open');
  document.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.route === route));
  pageTitle.textContent = routeMeta[route][0];
  pageSubtitle.textContent = routeMeta[route][1];
  if (route === 'dashboard') await renderDashboard();
  if (route === 'add') await renderAddTrade();
  if (route === 'journal') await renderJournal();
  if (route === 'analytics') await renderAnalytics();
}

async function renderDashboard() {
  const trades = await getTrades();
  const setups = groupCounts(trades, t => t.setupType);
  const weekdays = WEEKDAYS.map(day => ({ label: day, value: trades.filter(t => t.dayOfWeek === day).length }));
  const times = groupCounts(trades, t => t.timeOfDay);
  const tickers = groupCounts(trades, t => t.ticker).slice(0, 8);
  const options = trades.filter(t => t.contractType !== 'Stock').length;
  const uniqueTickers = new Set(trades.map(t => t.ticker)).size;
  const recordedPnLs = trades.map(resolvedTradePnL).filter(v => v !== null);
  const netPnL = recordedPnLs.reduce((sum, value) => sum + value, 0);
  const winningTrades = recordedPnLs.filter(value => value > 0).length;

  let migrationBanner = '';
  try {
    const legacy = await getLocalMigrationSummary();
    const migrated = await wasLocalDataMigrated();
    if (legacy.tradeCount > 0 && !migrated) {
      migrationBanner = `<div class="migration-banner"><div><strong>Local V1 data found</strong><span>${legacy.tradeCount} trade${legacy.tradeCount === 1 ? '' : 's'} and ${legacy.screenshotCount} screenshot${legacy.screenshotCount === 1 ? '' : 's'} can be copied into your cloud journal.</span></div><button class="primary-button" id="migrateLocal">Import Local Data to Cloud</button></div>`;
    }
  } catch (error) { console.warn('Local migration check skipped', error); }

  view.innerHTML = `${migrationBanner}
    <div class="grid stats-grid">
      <div class="stat-card"><div class="stat-label">Total Trades</div><div class="stat-value">${trades.length}</div><div class="stat-meta">All recorded trades</div></div>
      <div class="stat-card"><div class="stat-label">Unique Tickers</div><div class="stat-value">${uniqueTickers}</div><div class="stat-meta">Names traded</div></div>
      <div class="stat-card"><div class="stat-label">Net P/L</div><div class="stat-value ${pnlClass(netPnL)}">${formatMoney(netPnL, { sign: true })}</div><div class="stat-meta">Across ${recordedPnLs.length} trade${recordedPnLs.length === 1 ? '' : 's'} with P/L recorded</div></div>
      <div class="stat-card"><div class="stat-label">Winning Trades</div><div class="stat-value">${winningTrades}</div><div class="stat-meta">Positive recorded P/L</div></div>
    </div>
    <div class="grid chart-grid">
      ${chartCard('Trades by Setup', 'Your most-used trade setups.', barChart(setups.slice(0, 8), 'Create a setup and record your first trade.'))}
      ${chartCard('Trades by Day of Week', 'Trading frequency across weekdays.', barChart(weekdays))}
      ${chartCard('Trades by Time of Day', 'When you take the most trades.', barChart(times))}
      ${chartCard('Trades by Ticker', 'Your most frequently traded symbols.', barChart(tickers))}
    </div>`;

  document.querySelector('#migrateLocal')?.addEventListener('click', async () => {
    const button = document.querySelector('#migrateLocal');
    button.disabled = true;
    try {
      await migrateLocalDataToCloud(({ current, total, ticker }) => {
        button.textContent = `Importing ${current}/${total}${ticker ? ` · ${ticker}` : ''}`;
      });
      toast('Local trades imported to cloud');
      await renderDashboard();
    } catch (error) {
      console.error(error);
      toast(error.message || 'Could not import local data');
      button.disabled = false; button.textContent = 'Import Local Data to Cloud';
    }
  });
}

function chartCard(title, subtitle, body) {
  return `<div class="card"><div class="card-header"><div><h2>${title}</h2><p class="card-subtitle">${subtitle}</p></div></div>${body}</div>`;
}

function optionalNumber(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function tradeMetric(trade, key) {
  const value = trade?.customFields?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}


function tradeExits(trade) {
  const stored = normalizeExits(trade?.customFields?.exits || []);
  if (stored.length) return stored;
  const legacyExit = tradeMetric(trade, 'exitPrice');
  const legacySize = tradeMetric(trade, 'positionSize');
  if (legacyExit !== null && legacySize !== null && legacySize > 0) {
    return [{ quantity: legacySize, price: legacyExit }];
  }
  return [];
}

function resolvedTradePnL(trade) {
  const storedExits = normalizeExits(trade?.customFields?.exits || []);
  if (storedExits.length) return calculateRealizedPnL(tradeMetric(trade, 'entryPrice'), storedExits, trade.contractType);
  const legacyPnL = tradeMetric(trade, 'profitLoss');
  if (legacyPnL !== null) return legacyPnL;
  return calculateRealizedPnL(tradeMetric(trade, 'entryPrice'), tradeExits(trade), trade.contractType);
}

function positionUnit(contractType) {
  return contractType === 'Stock' ? 'shares' : 'contracts';
}

function collectExitRows(container, contractType, { strict = true } = {}) {
  const exits = [];
  for (const row of container?.querySelectorAll('.exit-row') || []) {
    const quantityText = row.querySelector('.exit-quantity')?.value?.trim() || '';
    const priceText = row.querySelector('.exit-price')?.value?.trim() || '';
    if (!quantityText && !priceText) continue;
    const quantity = optionalNumber(quantityText);
    const price = optionalNumber(priceText);
    if (strict && (quantity === null || price === null)) throw new Error('Each exit needs both a quantity and an exit price.');
    if (quantity === null || price === null) continue;
    if (quantity <= 0) { if (strict) throw new Error('Exit quantity must be greater than 0.'); else continue; }
    if (price < 0) { if (strict) throw new Error('Exit price cannot be negative.'); else continue; }
    if (contractType !== 'Stock' && !Number.isInteger(quantity)) { if (strict) throw new Error('Option exit quantities must be whole contracts.'); else continue; }
    exits.push({ quantity, price });
  }
  return exits;
}

function validateExitQuantity(positionSize, exits) {
  if (positionSize === null) return;
  const totalExited = exitedQuantity(exits);
  if (totalExited > positionSize + 1e-9) {
    throw new Error(`Exit quantity (${totalExited}) cannot be larger than the position size (${positionSize}).`);
  }
}

function validatePositionSize(positionSize, contractType) {
  if (positionSize === null) return;
  if (positionSize <= 0) throw new Error('Position size must be greater than 0.');
  if (contractType !== 'Stock' && !Number.isInteger(positionSize)) throw new Error('Option position size must be a whole number of contracts.');
}

function addExitRow(container, exit = {}, onChange = () => {}) {
  const row = document.createElement('div');
  row.className = 'exit-row';
  row.innerHTML = `
    <div class="field"><label>Quantity sold</label><input class="exit-quantity" type="number" inputmode="decimal" step="any" min="0" placeholder="e.g. 5" value="${exit.quantity ?? ''}"></div>
    <div class="field"><label>Exit Price</label><input class="exit-price" type="number" inputmode="decimal" step="0.01" min="0" placeholder="e.g. 1.70" value="${exit.price ?? ''}"></div>
    <button class="ghost-button exit-remove" type="button" aria-label="Remove exit">Remove</button>`;
  row.querySelectorAll('input').forEach(input => input.addEventListener('input', onChange));
  row.querySelector('.exit-remove').addEventListener('click', () => { row.remove(); onChange(); });
  container.appendChild(row);
  return row;
}

function updateExitPreview({ container, entryInput, sizeInput, contractSelect, pnlHost, summaryHost }) {
  const entryPrice = optionalNumber(entryInput?.value);
  const positionSize = optionalNumber(sizeInput?.value);
  const exits = collectExitRows(container, contractSelect?.value || 'Stock', { strict: false });
  const sold = exitedQuantity(exits);
  const average = weightedAverageExit(exits);
  const pnl = calculateRealizedPnL(entryPrice, exits, contractSelect?.value || 'Stock');
  if (pnlHost) {
    pnlHost.textContent = formatMoney(pnl, { sign: true });
    pnlHost.className = `readonly-value ${pnlClass(pnl)}`;
  }
  if (summaryHost) {
    const unit = positionUnit(contractSelect?.value || 'Stock');
    if (!exits.length) summaryHost.textContent = 'No exits recorded yet.';
    else {
      const remaining = positionSize === null ? null : Math.max(0, positionSize - sold);
      const remainingText = remaining === null ? '' : ` · ${remaining} ${unit} remaining`;
      summaryHost.textContent = `${sold} ${unit} sold · Avg exit ${formatMoney(average)}${remainingText}`;
    }
  }
}

function formatMoney(value, { sign = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  const absolute = Math.abs(number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (sign && number > 0) return `+$${absolute}`;
  if (number < 0) return `-$${absolute}`;
  return `$${absolute}`;
}

function pnlClass(value) {
  if (value === null || value === undefined) return '';
  if (value > 0) return 'pnl-positive';
  if (value < 0) return 'pnl-negative';
  return 'pnl-flat';
}

async function renderAddTrade() {
  const setups = await getSetups();
  const timeRules = await getTimeRules();
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const localTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  view.innerHTML = `
    <div class="grid" style="grid-template-columns:minmax(0,1.5fr) minmax(300px,.7fr); align-items:start">
      <form class="card" id="tradeForm">
        <div class="card-header"><div><h2>New Trade</h2><p class="card-subtitle">Core trade details plus execution and P/L.</p></div></div>
        <div class="form-section">
          <div class="form-section-title">Trade timing</div>
          <div class="form-grid">
            <div class="field"><label for="tradeDate">Trade Date</label><input id="tradeDate" name="tradeDate" type="date" required value="${localDate}"></div>
            <div class="field"><label for="tradeTime">Time of Trade</label><input id="tradeTime" name="tradeTime" type="time" required value="${localTime}"></div>
            <div class="field"><label>Day of Week</label><div class="readonly-value" id="dayDisplay"></div></div>
            <div class="field"><label>Time of Day</label><div class="readonly-value" id="timeDisplay"></div></div>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title">Trade identity</div>
          <div class="form-grid">
            <div class="field"><label for="ticker">Ticker</label><input id="ticker" name="ticker" maxlength="12" placeholder="TSLA" autocomplete="off" required></div>
            <div class="field"><label for="setupType">Setup Type</label><select id="setupType" name="setupType"><option value="">Select setup</option>${setups.map(s => `<option>${escapeHtml(s)}</option>`).join('')}</select></div>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title">Contract</div>
          <div class="form-grid">
            <div class="field"><label for="contractType">Trade Type</label><select id="contractType" name="contractType">${CONTRACT_TYPES.map(c => `<option>${c}</option>`).join('')}</select></div>
          </div>
          <div class="option-fields hidden" id="optionFields">
            <div class="form-grid">
              <div class="field"><label for="strikePrice">Strike Price</label><input id="strikePrice" name="strikePrice" type="number" inputmode="decimal" step="0.01" placeholder="250.00"></div>
              <div class="field"><label for="expirationDate">Expiration Date</label><input id="expirationDate" name="expirationDate" type="date"></div>
              <div class="field"><label>DTE</label><div class="readonly-value" id="dteDisplay">—</div></div>
              <div class="field"><label>Call / Put</label><div class="readonly-value" id="cpDisplay">—</div></div>
            </div>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title">Execution & exits</div>
          <div class="form-grid">
            <div class="field"><label for="entryPrice">Entry Price</label><input id="entryPrice" name="entryPrice" type="number" inputmode="decimal" step="0.01" min="0" placeholder="e.g. 1.20"></div>
            <div class="field"><label for="positionSize">Position Size</label><input id="positionSize" name="positionSize" type="number" inputmode="decimal" step="any" min="0" placeholder="Shares or contracts"></div>
            <div class="field"><label>Realized P/L</label><div class="readonly-value" id="realizedPnlDisplay">—</div><div class="helper">Calculated automatically from the exit quantities and prices below. Options use the standard 100x contract multiplier. V1.3 assumes a long trade (buy first, sell later).</div></div>
          </div>
          <div class="exit-builder">
            <div class="exit-builder-header"><div><strong>Partial Exits</strong><div class="helper">Record each scale-out separately.</div></div><button class="secondary-button" id="addExit" type="button">＋ Add Exit</button></div>
            <div class="exit-list" id="exitRows"></div>
            <div class="exit-summary" id="exitSummary">No exits recorded yet.</div>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title">Trade screenshots</div>
          <div class="field"><label for="screenshots">Upload one or more images</label><input id="screenshots" name="screenshots" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple><div class="helper">Screenshots upload privately to your cloud journal and sync across computers. Maximum 10 MB per image.</div></div>
          <div class="screenshot-preview" id="screenshotPreview"></div>
        </div>
        <div class="form-footer"><button type="reset" class="ghost-button">Clear</button><button type="submit" class="primary-button">Save Trade</button></div>
      </form>
      <div class="grid">
        <div class="card" id="setupManager"></div>
        <div class="card" id="timeManager"></div>
      </div>
    </div>`;

  if (window.innerWidth <= 900) view.firstElementChild.style.gridTemplateColumns = '1fr';

  const form = document.querySelector('#tradeForm');
  const dateInput = document.querySelector('#tradeDate');
  const timeInput = document.querySelector('#tradeTime');
  const tickerInput = document.querySelector('#ticker');
  const contract = document.querySelector('#contractType');
  const expiration = document.querySelector('#expirationDate');
  const screenshotInput = document.querySelector('#screenshots');
  const entryInput = document.querySelector('#entryPrice');
  const positionInput = document.querySelector('#positionSize');
  const exitRows = document.querySelector('#exitRows');
  const realizedPnlDisplay = document.querySelector('#realizedPnlDisplay');
  const exitSummary = document.querySelector('#exitSummary');

  const refreshDerived = () => {
    document.querySelector('#dayDisplay').textContent = dayOfWeek(dateInput.value);
    document.querySelector('#timeDisplay').textContent = categorizeTime(timeInput.value, timeRules);
    const dte = calculateDTE(dateInput.value, expiration.value);
    document.querySelector('#dteDisplay').textContent = dte === '' ? '—' : `${dte} days`;
  };
  const refreshExitPreview = () => updateExitPreview({ container: exitRows, entryInput, sizeInput: positionInput, contractSelect: contract, pnlHost: realizedPnlDisplay, summaryHost: exitSummary });
  const refreshContract = () => {
    const isOption = contract.value !== 'Stock';
    document.querySelector('#optionFields').classList.toggle('hidden', !isOption);
    document.querySelector('#cpDisplay').textContent = contract.value === 'Call Option' ? 'Call' : contract.value === 'Put Option' ? 'Put' : '—';
    refreshExitPreview();
  };

  dateInput.addEventListener('change', refreshDerived);
  timeInput.addEventListener('change', refreshDerived);
  expiration.addEventListener('change', refreshDerived);
  contract.addEventListener('change', refreshContract);
  tickerInput.addEventListener('input', () => { tickerInput.value = tickerInput.value.toUpperCase(); });
  screenshotInput.addEventListener('change', () => previewFiles(screenshotInput.files));
  entryInput.addEventListener('input', refreshExitPreview);
  positionInput.addEventListener('input', refreshExitPreview);
  document.querySelector('#addExit').addEventListener('click', () => addExitRow(exitRows, {}, refreshExitPreview));
  addExitRow(exitRows, {}, refreshExitPreview);
  refreshDerived(); refreshContract();
  form.addEventListener('reset', () => setTimeout(() => {
    exitRows.innerHTML = '';
    addExitRow(exitRows, {}, refreshExitPreview);
    previewFiles([]);
    refreshDerived();
    refreshContract();
  }, 0));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Saving…';
    try {
      const screenshotFiles = [...screenshotInput.files];
      const tradeDate = dateInput.value;
      const tradeTime = timeInput.value;
      const contractType = contract.value;
      const trade = {
        id: crypto.randomUUID(),
        schemaVersion: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tradeDate,
        tradeTime,
        dayOfWeek: dayOfWeek(tradeDate),
        timeOfDay: categorizeTime(tradeTime, timeRules),
        ticker: normalizeTicker(tickerInput.value),
        setupType: document.querySelector('#setupType').value,
        contractType,
        option: contractType === 'Stock' ? null : {
          side: contractType === 'Call Option' ? 'Call' : 'Put',
          strikePrice: document.querySelector('#strikePrice').value ? Number(document.querySelector('#strikePrice').value) : null,
          expirationDate: expiration.value || null,
          dte: calculateDTE(tradeDate, expiration.value) === '' ? null : calculateDTE(tradeDate, expiration.value),
        },
        screenshots: [],
        customFields: (() => {
          const entryPrice = optionalNumber(entryInput.value);
          const positionSize = optionalNumber(positionInput.value);
          const exits = collectExitRows(exitRows, contractType);
          validatePositionSize(positionSize, contractType);
          validateExitQuantity(positionSize, exits);
          const averageExit = weightedAverageExit(exits);
          const profitLoss = calculateRealizedPnL(entryPrice, exits, contractType);
          return {
            entryPrice,
            positionSize,
            exits,
            exitPrice: averageExit,
            profitLoss,
          };
        })(),
      };
      await saveTrade(trade, screenshotFiles);
      toast(`${trade.ticker} trade saved`);
      await navigate('journal');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Could not save trade');
      submit.disabled = false;
      submit.textContent = 'Save Trade';
    }
  });

  await renderSetupManager(setups);
  await renderTimeManager(timeRules);
}

function previewFiles(files) {
  const wrap = document.querySelector('#screenshotPreview');
  wrap.innerHTML = '';
  [...files].forEach(file => {
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = URL.createObjectURL(file);
    img.alt = file.name;
    wrap.appendChild(img);
  });
}

async function renderSetupManager(setups) {
  const box = document.querySelector('#setupManager');
  if (!box) return;
  box.innerHTML = `<div class="card-header"><div><h2>Setup Types</h2><p class="card-subtitle">Create your own evolving setup library.</p></div></div>
    <div class="inline-actions"><input id="newSetup" placeholder="e.g. Opening Range Breakout"><button class="secondary-button" id="addSetup">Add</button></div>
    <div class="setup-list">${setups.length ? setups.map((s, i) => `<div class="setup-row"><span>${escapeHtml(s)}</span><button class="ghost-button" data-edit-setup="${i}">Edit</button><button class="danger-button" data-delete-setup="${i}">Delete</button></div>`).join('') : '<div class="helper">No setups yet. Add your first setup here.</div>'}</div>`;
  box.querySelector('#addSetup').addEventListener('click', async () => {
    const input = box.querySelector('#newSetup'); const value = input.value.trim(); if (!value) return;
    if (!setups.some(s => s.toLowerCase() === value.toLowerCase())) setups.push(value);
    await saveSetups(setups); toast('Setup added'); await renderAddTrade();
  });
  box.querySelectorAll('[data-delete-setup]').forEach(btn => btn.addEventListener('click', async () => {
    setups.splice(Number(btn.dataset.deleteSetup), 1); await saveSetups(setups); toast('Setup deleted'); await renderAddTrade();
  }));
  box.querySelectorAll('[data-edit-setup]').forEach(btn => btn.addEventListener('click', async () => {
    const i = Number(btn.dataset.editSetup); const next = prompt('Rename setup', setups[i]);
    if (next?.trim()) { setups[i] = next.trim(); await saveSetups(setups); toast('Setup updated'); await renderAddTrade(); }
  }));
}

async function renderTimeManager(rules) {
  const box = document.querySelector('#timeManager');
  if (!box) return;
  const sorted = [...rules].sort((a,b) => a.start.localeCompare(b.start));
  box.innerHTML = `<div class="card-header"><div><h2>Time-of-Day Rules</h2><p class="card-subtitle">Editable starting boundaries for automatic categorization.</p></div></div>
    <div class="time-rule-list">${sorted.map(r => `<div class="time-rule-row"><input data-time-label="${r.id}" value="${escapeHtml(r.label)}"><input data-time-start="${r.id}" type="time" value="${r.start}"><button class="ghost-button" data-time-save="${r.id}">Save</button></div>`).join('')}</div>
    <p class="helper">Each category begins at its listed time and continues until the next category starts.</p>`;
  box.querySelectorAll('[data-time-save]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.timeSave;
    const rule = rules.find(r => r.id === id);
    rule.label = box.querySelector(`[data-time-label="${id}"]`).value.trim() || rule.label;
    rule.start = box.querySelector(`[data-time-start="${id}"]`).value || rule.start;
    await saveTimeRules(rules); toast('Time rule updated'); await renderAddTrade();
  }));
}

async function renderJournal() {
  const trades = await getTrades();
  const setups = [...new Set(trades.map(t => t.setupType).filter(Boolean))].sort();
  const times = [...new Set(trades.map(t => t.timeOfDay).filter(Boolean))].sort();
  view.innerHTML = `
    <div class="card">
      <div class="filters">
        <input class="search" id="fTicker" placeholder="Search ticker…">
        <select id="fSetup"><option value="">All setups</option>${setups.map(x => `<option>${escapeHtml(x)}</option>`).join('')}</select>
        <select id="fDay"><option value="">All weekdays</option>${WEEKDAYS.map(x => `<option>${x}</option>`).join('')}</select>
        <select id="fTime"><option value="">All times</option>${times.map(x => `<option>${escapeHtml(x)}</option>`).join('')}</select>
        <select id="fContract"><option value="">All contracts</option>${CONTRACT_TYPES.map(x => `<option>${x}</option>`).join('')}</select>
        <button class="ghost-button" id="clearFilters">Clear</button>
      </div>
      <div id="journalTable"></div>
    </div>`;
  const inputs = ['#fTicker','#fSetup','#fDay','#fTime','#fContract'].map(s => document.querySelector(s));
  inputs.forEach(el => el.addEventListener('input', () => drawJournalTable(trades)));
  document.querySelector('#clearFilters').addEventListener('click', () => { inputs.forEach(el => el.value = ''); drawJournalTable(trades); });
  drawJournalTable(trades);
}

function drawJournalTable(allTrades) {
  const ticker = document.querySelector('#fTicker').value.trim().toUpperCase();
  const setup = document.querySelector('#fSetup').value;
  const day = document.querySelector('#fDay').value;
  const time = document.querySelector('#fTime').value;
  const contract = document.querySelector('#fContract').value;
  const trades = allTrades.filter(t =>
    (!ticker || t.ticker.includes(ticker)) && (!setup || t.setupType === setup) && (!day || t.dayOfWeek === day) && (!time || t.timeOfDay === time) && (!contract || t.contractType === contract)
  ).sort((a,b) => {
    const A = `${a.tradeDate}T${a.tradeTime}`; const B = `${b.tradeDate}T${b.tradeTime}`;
    return tradeSort === 'desc' ? B.localeCompare(A) : A.localeCompare(B);
  });
  const host = document.querySelector('#journalTable');
  if (!trades.length) { host.innerHTML = '<div class="empty-state"><strong>No matching trades</strong>Try changing the filters or add a new trade.</div>'; return; }
  host.innerHTML = `<div class="table-wrap"><table class="trade-table"><thead><tr>
    <th><button class="sort-button" id="sortDate">Date ${tradeSort === 'desc' ? '↓' : '↑'}</button></th><th>Time</th><th>Day</th><th>Ticker</th><th>Setup</th><th>Contract</th><th>Entry</th><th>Exits</th><th>Size</th><th>Realized P/L</th><th>Screenshot</th><th></th>
    </tr></thead><tbody>${trades.map(t => {
      const pnl = resolvedTradePnL(t);
      const exits = tradeExits(t);
      const averageExit = weightedAverageExit(exits);
      const exitLabel = exits.length ? `${exits.length} exit${exits.length === 1 ? '' : 's'} · avg ${formatMoney(averageExit)}` : '—';
      return `<tr>
      <td>${formatDate(t.tradeDate)}</td><td>${formatTime(t.tradeTime)}</td><td>${escapeHtml(t.dayOfWeek)}</td><td class="ticker">${escapeHtml(t.ticker)}</td><td>${escapeHtml(t.setupType || '—')}</td>
      <td><span class="pill">${escapeHtml(t.contractType)}</span></td><td>${formatMoney(tradeMetric(t, 'entryPrice'))}</td><td><span class="exit-cell">${escapeHtml(exitLabel)}</span></td><td>${tradeMetric(t, 'positionSize') ?? '—'}</td><td class="${pnlClass(pnl)}">${formatMoney(pnl, { sign: true })}</td><td>${screenshotCell(t)}</td>
      <td><button class="secondary-button" data-open-trade="${t.id}">Review</button></td>
    </tr>`;
    }).join('')}</tbody></table></div>`;
  host.querySelector('#sortDate').addEventListener('click', () => { tradeSort = tradeSort === 'desc' ? 'asc' : 'desc'; drawJournalTable(allTrades); });
  host.querySelectorAll('[data-open-trade]').forEach(btn => btn.addEventListener('click', () => openTrade(btn.dataset.openTrade)));
}

function screenshotCell(trade) {
  if (!trade.screenshots?.length) return '<span class="helper">None</span>';
  return `<div class="screenshot-stack"><img class="table-thumb" src="${(trade.screenshots[0].signedUrl || trade.screenshots[0].dataUrl || '')}" alt="Trade screenshot"><span class="screenshot-count">${trade.screenshots.length} image${trade.screenshots.length > 1 ? 's' : ''}</span></div>`;
}

async function renderAnalytics() {
  const trades = await getTrades();
  const setup = groupCounts(trades, t => t.setupType);
  const day = WEEKDAYS.map(d => ({ label: d, value: trades.filter(t => t.dayOfWeek === d).length }));
  const time = groupCounts(trades, t => t.timeOfDay);
  const ticker = groupCounts(trades, t => t.ticker);
  const contract = CONTRACT_TYPES.map(c => ({ label: c === 'Call Option' ? 'Calls' : c === 'Put Option' ? 'Puts' : 'Stocks', value: trades.filter(t => t.contractType === c).length }));
  view.innerHTML = `<div class="analytics-note">Analytics currently focus on trading behavior and frequency, while the Dashboard now also summarizes recorded P/L. The schema still leaves room for risk, R-multiple, notes, reviews, and future AI analysis without redesigning the core trade record.</div>
    <div class="grid chart-grid">
      ${chartCard('Trades by Setup','Frequency by your custom setup types.',barChart(setup))}
      ${chartCard('Trades by Day of Week','Monday through Friday.',barChart(day))}
      ${chartCard('Trades by Time of Day','Based on your editable time rules.',barChart(time))}
      ${chartCard('Trades by Ticker','Most frequently traded symbols.',barChart(ticker.slice(0,12)))}
      ${chartCard('Trades by Contract Type','Calls, puts, and stock trades.',barChart(contract))}
    </div>`;
}

async function openTrade(id) {
  const trades = await getTrades();
  const t = trades.find(x => x.id === id);
  if (!t) return;
  const exits = tradeExits(t);
  const entryPrice = tradeMetric(t, 'entryPrice');
  const positionSize = tradeMetric(t, 'positionSize');
  const soldQuantity = exitedQuantity(exits);
  const remainingQuantity = positionSize === null ? null : Math.max(0, positionSize - soldQuantity);
  const averageExit = weightedAverageExit(exits);
  const realizedPnL = resolvedTradePnL(t);
  const unit = positionUnit(t.contractType);
  const exitBreakdown = exits.length ? exits.map((exit, index) => {
    const legPnL = calculateRealizedPnL(entryPrice, [exit], t.contractType);
    return `<div class="exit-detail-row"><div><span class="exit-number">Exit ${index + 1}</span><strong>${exit.quantity} ${unit} @ ${formatMoney(exit.price)}</strong></div><div class="${pnlClass(legPnL)}">${formatMoney(legPnL, { sign: true })}</div></div>`;
  }).join('') : '<div class="helper">No exits recorded yet.</div>';

  modalTitle.textContent = 'Trade Review';
  modalBody.innerHTML = `
    <div class="detail-header"><div><div class="detail-ticker">${escapeHtml(t.ticker)}</div><div class="detail-meta">${formatDate(t.tradeDate)} · ${formatTime(t.tradeTime)}</div></div><button class="danger-button" id="deleteTrade">Delete Trade</button></div>
    <div class="detail-grid">
      ${detailItem('Day of Week', t.dayOfWeek)}${detailItem('Time of Day', t.timeOfDay)}${detailItem('Setup', t.setupType || '—')}
      ${detailItem('Contract Type', t.contractType)}${detailItem('Strike', t.option?.strikePrice ?? '—')}${detailItem('Expiration', t.option?.expirationDate ? formatDate(t.option.expirationDate) : '—')}
      ${detailItem('DTE', t.option?.dte ?? '—')}${detailItem('Entry Price', formatMoney(entryPrice))}${detailItem('Position Size', positionSize === null ? '—' : `${positionSize} ${unit}`)}
      ${detailItem('Exited', exits.length ? `${soldQuantity} ${unit}` : '—')}${detailItem('Remaining', remainingQuantity === null ? '—' : `${remainingQuantity} ${unit}`)}${detailItem('Avg Exit', formatMoney(averageExit))}
      ${detailItem('Realized P/L', formatMoney(realizedPnL, { sign: true }))}
    </div>
    <div class="card exit-breakdown-card">
      <div class="card-header"><div><h3>Exit Breakdown</h3><p class="card-subtitle">Every partial sale is kept as part of this trade.</p></div></div>
      <div class="exit-detail-list">${exitBreakdown}</div>
    </div>
    <div class="card result-editor">
      <div class="card-header"><div><h3>Edit Execution & Exits</h3><p class="card-subtitle">Add, remove, or change partial exits at any time.</p></div></div>
      <div class="form-grid">
        <div class="field"><label for="reviewEntryPrice">Entry Price</label><input id="reviewEntryPrice" type="number" step="0.01" min="0" value="${entryPrice ?? ''}"></div>
        <div class="field"><label for="reviewPositionSize">Position Size</label><input id="reviewPositionSize" type="number" step="any" min="0" value="${positionSize ?? ''}"></div>
        <div class="field"><label>Realized P/L</label><div class="readonly-value ${pnlClass(realizedPnL)}" id="reviewPnlDisplay">${formatMoney(realizedPnL, { sign: true })}</div></div>
      </div>
      <div class="exit-builder">
        <div class="exit-builder-header"><div><strong>Partial Exits</strong><div class="helper">Quantity sold + price for each scale-out.</div></div><button class="secondary-button" id="reviewAddExit" type="button">＋ Add Exit</button></div>
        <div class="exit-list" id="reviewExitRows"></div>
        <div class="exit-summary" id="reviewExitSummary"></div>
      </div>
      <div class="form-footer"><button class="primary-button" id="saveTradeResults">Save Results</button></div>
    </div>
    <h3>Trade Screenshots</h3>
    <div class="large-screenshots">${t.screenshots?.length ? t.screenshots.map(s => `<a href="${(s.signedUrl || s.dataUrl || '')}" target="_blank" rel="noopener"><img src="${(s.signedUrl || s.dataUrl || '')}" alt="${escapeHtml(s.name)}"></a>`).join('') : '<div class="helper">No screenshots attached.</div>'}</div>
    <div class="future-zone"><strong>Reserved for future trade review fields.</strong><br><br>Risk, R-multiple, notes, emotions, mistakes, grades, before/after images, and AI analysis can be added here later.</div>`;
  modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false');

  const reviewEntry = document.querySelector('#reviewEntryPrice');
  const reviewSize = document.querySelector('#reviewPositionSize');
  const reviewRows = document.querySelector('#reviewExitRows');
  const reviewPnl = document.querySelector('#reviewPnlDisplay');
  const reviewSummary = document.querySelector('#reviewExitSummary');
  const contractProxy = { value: t.contractType };
  const refreshReview = () => updateExitPreview({ container: reviewRows, entryInput: reviewEntry, sizeInput: reviewSize, contractSelect: contractProxy, pnlHost: reviewPnl, summaryHost: reviewSummary });
  (exits.length ? exits : [{}]).forEach(exit => addExitRow(reviewRows, exit, refreshReview));
  reviewEntry.addEventListener('input', refreshReview);
  reviewSize.addEventListener('input', refreshReview);
  document.querySelector('#reviewAddExit').addEventListener('click', () => addExitRow(reviewRows, {}, refreshReview));
  refreshReview();

  document.querySelector('#saveTradeResults').addEventListener('click', async () => {
    const button = document.querySelector('#saveTradeResults');
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const nextEntry = optionalNumber(reviewEntry.value);
      const nextSize = optionalNumber(reviewSize.value);
      const nextExits = collectExitRows(reviewRows, t.contractType);
      validatePositionSize(nextSize, t.contractType);
      validateExitQuantity(nextSize, nextExits);
      const nextAverageExit = weightedAverageExit(nextExits);
      const nextPnL = calculateRealizedPnL(nextEntry, nextExits, t.contractType);
      const updatedTrade = {
        ...t,
        schemaVersion: Math.max(3, t.schemaVersion || 1),
        updatedAt: new Date().toISOString(),
        customFields: {
          ...(t.customFields || {}),
          entryPrice: nextEntry,
          positionSize: nextSize,
          exits: nextExits,
          exitPrice: nextAverageExit,
          profitLoss: nextPnL,
        },
      };
      await saveTrade(updatedTrade);
      toast('Trade exits updated');
      closeModal();
      if (currentRoute === 'journal') await renderJournal(); else await renderDashboard();
    } catch (error) {
      console.error(error);
      toast(error.message || 'Could not update trade');
      button.disabled = false;
      button.textContent = 'Save Results';
    }
  });
  document.querySelector('#deleteTrade').addEventListener('click', async () => {
    if (confirm(`Delete ${t.ticker} trade from ${formatDate(t.tradeDate)}?`)) { await deleteTrade(t.id); closeModal(); toast('Trade deleted'); if (currentRoute === 'journal') await renderJournal(); else await renderDashboard(); }
  });
}

function detailItem(k, v) { return `<div class="detail-item"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(String(v ?? '—'))}</div></div>`; }
function closeModal() { modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); }

boot();
