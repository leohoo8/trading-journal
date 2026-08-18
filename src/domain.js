export const DEFAULT_TIME_RULES = [
  { id: 'premarket', label: 'Pre-Market', start: '00:00' },
  { id: 'open', label: 'Market Open', start: '09:30' },
  { id: 'morning', label: 'Morning', start: '10:00' },
  { id: 'midday', label: 'Midday', start: '12:00' },
  { id: 'afternoon', label: 'Afternoon', start: '14:00' },
  { id: 'power', label: 'Power Hour', start: '15:00' },
  { id: 'after', label: 'After Hours', start: '16:00' },
];

export const CONTRACT_TYPES = ['Stock', 'Call Option', 'Put Option'];
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export function dayOfWeek(dateString) {
  if (!dateString) return '—';
  const [y, m, d] = dateString.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: 'long' });
}

function timeToMinutes(time) {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function categorizeTime(time, rules = DEFAULT_TIME_RULES) {
  if (!time) return '—';
  const mins = timeToMinutes(time);
  const sorted = [...rules].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  let selected = sorted[0]?.label || '—';
  for (const rule of sorted) {
    if (mins >= timeToMinutes(rule.start)) selected = rule.label;
  }
  return selected;
}

export function calculateDTE(tradeDate, expirationDate) {
  if (!tradeDate || !expirationDate) return '';
  const [ty, tm, td] = tradeDate.split('-').map(Number);
  const [ey, em, ed] = expirationDate.split('-').map(Number);
  const start = Date.UTC(ty, tm - 1, td);
  const end = Date.UTC(ey, em - 1, ed);
  return Math.ceil((end - start) / 86400000);
}

export function normalizeTicker(value = '') {
  return value.trim().toUpperCase();
}

export function formatDate(dateString) {
  if (!dateString) return '—';
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

export function formatTime(time) {
  if (!time) return '—';
  const [h, m] = time.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function groupCounts(items, keyFn) {
  const out = new Map();
  for (const item of items) {
    const key = keyFn(item) || 'Unspecified';
    out.set(key, (out.get(key) || 0) + 1);
  }
  return [...out.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}


export function normalizeExits(exits = []) {
  if (!Array.isArray(exits)) return [];
  return exits.map(exit => ({
    quantity: Number(exit?.quantity),
    price: Number(exit?.price),
  })).filter(exit => Number.isFinite(exit.quantity) && exit.quantity > 0 && Number.isFinite(exit.price) && exit.price >= 0);
}

export function exitedQuantity(exits = []) {
  return normalizeExits(exits).reduce((sum, exit) => sum + exit.quantity, 0);
}

export function weightedAverageExit(exits = []) {
  const clean = normalizeExits(exits);
  const quantity = clean.reduce((sum, exit) => sum + exit.quantity, 0);
  if (!quantity) return null;
  return clean.reduce((sum, exit) => sum + exit.quantity * exit.price, 0) / quantity;
}

export function calculateRealizedPnL(entryPrice, exits = [], contractType = 'Stock') {
  const entry = Number(entryPrice);
  if (!Number.isFinite(entry)) return null;
  const clean = normalizeExits(exits);
  if (!clean.length) return null;
  const multiplier = contractType === 'Stock' ? 1 : 100;
  return clean.reduce((sum, exit) => sum + ((exit.price - entry) * exit.quantity * multiplier), 0);
}
