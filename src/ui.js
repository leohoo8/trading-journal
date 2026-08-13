export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function barChart(items, emptyText = 'No trade data yet.') {
  if (!items.length) return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  const max = Math.max(...items.map(i => i.value), 1);
  return `<div class="bar-list">${items.map(item => `
    <div class="bar-row">
      <div class="bar-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, item.value / max * 100)}%"></div></div>
      <div class="bar-value">${item.value}</div>
    </div>`).join('')}</div>`;
}

export function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: reader.result,
    });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
