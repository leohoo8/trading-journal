import { DEFAULT_TIME_RULES } from './domain.js';

const CONFIG_KEY = 'trading-journal-cloud-config-v1';
const LEGACY_DB_NAME = 'trading-journal-v1';
const LEGACY_DB_VERSION = 1;
const LEGACY_TRADE_STORE = 'trades';
const LEGACY_SETTINGS_STORE = 'settings';
const SCREENSHOT_BUCKET = 'trade-screenshots';
const SIGNED_URL_SECONDS = 60 * 60;

let client = null;
let clientConfigKey = '';

export function getCloudConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveCloudConfig({ url, key }) {
  const clean = {
    url: String(url || '').trim().replace(/\/$/, ''),
    key: String(key || '').trim(),
  };
  if (!/^https:\/\/[^/]+\.supabase\.co$/i.test(clean.url)) {
    throw new Error('Enter a valid Supabase project URL, such as https://xxxxx.supabase.co');
  }
  if (clean.key.length < 20) throw new Error('Enter your Supabase publishable key.');
  localStorage.setItem(CONFIG_KEY, JSON.stringify(clean));
  client = null;
  clientConfigKey = '';
  return clean;
}

export function clearCloudConfig() {
  localStorage.removeItem(CONFIG_KEY);
  client = null;
  clientConfigKey = '';
}

async function supabaseClient() {
  const config = getCloudConfig();
  if (!config?.url || !config?.key) throw new Error('Cloud storage is not configured yet.');
  const nextKey = `${config.url}|${config.key}`;
  if (client && clientConfigKey === nextKey) return client;

  let createClient;
  try {
    ({ createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'));
  } catch (error) {
    console.error(error);
    throw new Error('Could not load the Supabase client. Check your internet connection and try again.');
  }

  client = createClient(config.url, config.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  clientConfigKey = nextKey;
  return client;
}

export async function testCloudConnection() {
  const sb = await supabaseClient();
  const { error } = await sb.auth.getSession();
  if (error) throw error;
  return true;
}

export async function getSession() {
  const sb = await supabaseClient();
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session || null;
}

export async function getCurrentUser() {
  const session = await getSession();
  return session?.user || null;
}

export async function signUp(email, password) {
  const sb = await supabaseClient();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const sb = await supabaseClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const sb = await supabaseClient();
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

export async function onAuthStateChange(callback) {
  const sb = await supabaseClient();
  return sb.auth.onAuthStateChange((_event, session) => callback(session));
}

function requireUser(session) {
  const user = session?.user;
  if (!user) throw new Error('Please sign in to access your cloud journal.');
  return user;
}

function rowToTrade(row) {
  return {
    id: row.id,
    schemaVersion: row.schema_version ?? 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tradeDate: row.trade_date,
    tradeTime: row.trade_time ? String(row.trade_time).slice(0, 5) : '',
    dayOfWeek: row.day_of_week,
    timeOfDay: row.time_of_day,
    ticker: row.ticker,
    setupType: row.setup_type || '',
    contractType: row.contract_type,
    option: row.option_data || null,
    screenshots: Array.isArray(row.screenshots) ? row.screenshots : [],
    customFields: row.custom_fields || {},
  };
}

function tradeToRow(trade, userId) {
  return {
    id: trade.id,
    user_id: userId,
    schema_version: trade.schemaVersion ?? 1,
    trade_date: trade.tradeDate,
    trade_time: trade.tradeTime,
    day_of_week: trade.dayOfWeek,
    time_of_day: trade.timeOfDay,
    ticker: trade.ticker,
    setup_type: trade.setupType || null,
    contract_type: trade.contractType,
    option_data: trade.option || null,
    screenshots: Array.isArray(trade.screenshots) ? trade.screenshots.map(stripSignedUrl) : [],
    custom_fields: trade.customFields || {},
    created_at: trade.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function stripSignedUrl(item) {
  if (!item || typeof item !== 'object') return item;
  const { signedUrl, dataUrl, ...rest } = item;
  return rest;
}

function safeFilename(name = 'screenshot.png') {
  const cleaned = String(name)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return cleaned || 'screenshot.png';
}

async function uploadScreenshots(sb, userId, tradeId, files, existing = []) {
  if (!files?.length) return existing.map(stripSignedUrl);
  const output = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const path = `${userId}/${tradeId}/${String(index + 1).padStart(2, '0')}-${safeFilename(file.name)}`;
    const { error } = await sb.storage.from(SCREENSHOT_BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type || undefined,
    });
    if (error) throw error;
    output.push({
      name: file.name || `Screenshot ${index + 1}`,
      type: file.type || 'image/*',
      size: Number(file.size || 0),
      path,
    });
  }
  return output;
}

async function attachSignedUrls(sb, trades) {
  const paths = [];
  for (const trade of trades) {
    for (const shot of trade.screenshots || []) if (shot?.path) paths.push(shot.path);
  }
  if (!paths.length) return trades;

  const uniquePaths = [...new Set(paths)];
  const { data, error } = await sb.storage.from(SCREENSHOT_BUCKET).createSignedUrls(uniquePaths, SIGNED_URL_SECONDS);
  if (error) {
    console.warn('Could not sign screenshot URLs', error);
    return trades;
  }
  const urlByPath = new Map((data || []).map(item => [item.path, item.signedUrl]));
  return trades.map(trade => ({
    ...trade,
    screenshots: (trade.screenshots || []).map(shot => ({ ...shot, signedUrl: urlByPath.get(shot.path) || '' })),
  }));
}

export async function getTrades() {
  const sb = await supabaseClient();
  requireUser(await getSession());
  const { data, error } = await sb
    .from('trades')
    .select('*')
    .order('trade_date', { ascending: false })
    .order('trade_time', { ascending: false });
  if (error) throw error;
  return attachSignedUrls(sb, (data || []).map(rowToTrade));
}

export async function getTrade(id) {
  const sb = await supabaseClient();
  requireUser(await getSession());
  const { data, error } = await sb.from('trades').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [trade] = await attachSignedUrls(sb, [rowToTrade(data)]);
  return trade;
}

export async function saveTrade(trade, screenshotFiles = []) {
  const sb = await supabaseClient();
  const user = requireUser(await getSession());
  const screenshots = await uploadScreenshots(sb, user.id, trade.id, screenshotFiles, trade.screenshots || []);
  const completeTrade = { ...trade, screenshots };
  const row = tradeToRow(completeTrade, user.id);
  const { data, error } = await sb.from('trades').upsert(row, { onConflict: 'id' }).select().single();
  if (error) throw error;
  const [result] = await attachSignedUrls(sb, [rowToTrade(data)]);
  return result;
}

export async function deleteTrade(id) {
  const sb = await supabaseClient();
  requireUser(await getSession());
  const existing = await getTrade(id);
  const paths = (existing?.screenshots || []).map(s => s.path).filter(Boolean);
  if (paths.length) {
    const { error: storageError } = await sb.storage.from(SCREENSHOT_BUCKET).remove(paths);
    if (storageError) throw storageError;
  }
  const { error } = await sb.from('trades').delete().eq('id', id);
  if (error) throw error;
}

export async function getSetting(key, fallback) {
  const sb = await supabaseClient();
  requireUser(await getSession());
  const { data, error } = await sb.from('journal_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value ?? fallback;
}

export async function setSetting(key, value) {
  const sb = await supabaseClient();
  const user = requireUser(await getSession());
  const { error } = await sb.from('journal_settings').upsert({
    user_id: user.id,
    key,
    value,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,key' });
  if (error) throw error;
}

export async function getSetups() {
  return getSetting('setupTypes', []);
}

export async function saveSetups(setups) {
  return setSetting('setupTypes', setups);
}

export async function getTimeRules() {
  return getSetting('timeRules', DEFAULT_TIME_RULES);
}

export async function saveTimeRules(rules) {
  return setSetting('timeRules', rules);
}

function openLegacyDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME, LEGACY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_TRADE_STORE)) {
        const trades = db.createObjectStore(LEGACY_TRADE_STORE, { keyPath: 'id' });
        trades.createIndex('tradeDate', 'tradeDate');
      }
      if (!db.objectStoreNames.contains(LEGACY_SETTINGS_STORE)) {
        db.createObjectStore(LEGACY_SETTINGS_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function legacyGetAll(storeName) {
  const db = await openLegacyDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getLocalMigrationSummary() {
  const [trades, settings] = await Promise.all([
    legacyGetAll(LEGACY_TRADE_STORE),
    legacyGetAll(LEGACY_SETTINGS_STORE),
  ]);
  return {
    tradeCount: trades.length,
    screenshotCount: trades.reduce((sum, t) => sum + (t.screenshots?.length || 0), 0),
    hasSetups: settings.some(s => s.key === 'setupTypes' && Array.isArray(s.value) && s.value.length),
    hasTimeRules: settings.some(s => s.key === 'timeRules' && Array.isArray(s.value) && s.value.length),
  };
}

function dataUrlToFile(item, fallbackName) {
  if (!item?.dataUrl) return null;
  const [header, body] = item.dataUrl.split(',');
  const mime = item.type || header.match(/data:([^;]+)/)?.[1] || 'image/png';
  const binary = atob(body || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], item.name || fallbackName, { type: mime });
}

export async function migrateLocalDataToCloud(progressCallback = () => {}) {
  const sb = await supabaseClient();
  const user = requireUser(await getSession());
  const [legacyTrades, legacySettings] = await Promise.all([
    legacyGetAll(LEGACY_TRADE_STORE),
    legacyGetAll(LEGACY_SETTINGS_STORE),
  ]);

  for (let i = 0; i < legacyTrades.length; i += 1) {
    const legacy = legacyTrades[i];
    progressCallback({ current: i + 1, total: legacyTrades.length, ticker: legacy.ticker || '' });
    const files = (legacy.screenshots || [])
      .map((shot, index) => dataUrlToFile(shot, `screenshot-${index + 1}.png`))
      .filter(Boolean);
    const cleanTrade = { ...legacy, screenshots: [] };
    const screenshots = await uploadScreenshots(sb, user.id, cleanTrade.id, files, []);
    const row = tradeToRow({ ...cleanTrade, screenshots }, user.id);
    const { error } = await sb.from('trades').upsert(row, { onConflict: 'id' });
    if (error) throw error;
  }

  for (const setting of legacySettings) {
    if (!['setupTypes', 'timeRules'].includes(setting.key)) continue;
    const { error } = await sb.from('journal_settings').upsert({
      user_id: user.id,
      key: setting.key,
      value: setting.value,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,key' });
    if (error) throw error;
  }

  localStorage.setItem(`trading-journal-local-migrated-${user.id}`, new Date().toISOString());
  return { trades: legacyTrades.length };
}

export async function wasLocalDataMigrated() {
  const user = requireUser(await getSession());
  return Boolean(localStorage.getItem(`trading-journal-local-migrated-${user.id}`));
}
