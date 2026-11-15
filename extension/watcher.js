// Следит за выбранной суммой на рабочем сайте и сообщает об изменениях.
// Защита от ложных срабатываний: новое значение отправляется, только когда оно держится
// 1,5 секунды подряд, а уменьшение — 15 секунд (страница могла на миг показать 0 при загрузке).
(() => {
  if (window.__smenyWatcher) return;
  window.__smenyWatcher = true;

  const TICK = 1000;
  let cfg = null;
  let sent = null; // последнее отправленное значение
  let candidate = null;
  let candidateSince = 0;
  let firstAfterPick = false;
  let badge = null;

  function parseMoney(text) {
    if (!text) return null;
    const m = String(text)
      .replace(/[   ]/g, ' ')
      .match(/[-−–]?\s*\d[\d\s.,']*/);
    if (!m) return null;
    let s = m[0].replace(/[−–]/, '-').replace(/[\s']/g, '');
    const neg = s.startsWith('-');
    s = s.replace('-', '').replace(/[.,]$/, '');
    const c = s.lastIndexOf(',');
    const d = s.lastIndexOf('.');
    if (c > -1 && d > -1) {
      const dec = c > d ? ',' : '.';
      s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
    } else if (c > -1) {
      s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(/,/g, '.');
    } else if (d > -1 && /^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
      s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) ? (neg ? -n : n) : null;
  }

  function read() {
    try {
      const el = document.querySelector(cfg.selector);
      if (!el) return null;
      return parseMoney(el.innerText || el.textContent || el.value);
    } catch {
      return null;
    }
  }

  function showBadge(text, ok = true) {
    if (!cfg?.badge) {
      badge?.remove();
      badge = null;
      return;
    }
    if (!badge) {
      badge = document.createElement('div');
      badge.style.cssText =
        'position:fixed;right:14px;bottom:14px;z-index:2147483647;font:600 12px/1 system-ui,sans-serif;' +
        'padding:8px 11px;border-radius:999px;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.25);pointer-events:none;' +
        'display:flex;gap:6px;align-items:center;transition:background .3s';
      document.documentElement.appendChild(badge);
    }
    badge.style.background = ok ? '#059669' : '#9f1239';
    badge.textContent = `💧 ${text}`;
  }

  function send(value) {
    const reset = firstAfterPick;
    firstAfterPick = false;
    chrome.runtime.sendMessage({ type: 'reading', value, page: location.href, reset }).catch(() => {});
  }

  function tick() {
    if (!cfg?.enabled) return;
    const v = read();
    if (v === null) {
      showBadge('сумма не найдена на странице', false);
      return;
    }
    const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v);
    if (v === sent) {
      candidate = null;
      showBadge(`слежу: ${fmt}`);
      return;
    }
    if (v !== candidate) {
      candidate = v;
      candidateSince = Date.now();
      return;
    }
    const need = sent !== null && v < sent ? 15000 : 1500;
    if (Date.now() - candidateSince >= need) {
      sent = v;
      candidate = null;
      send(v);
      showBadge(`отправлено: ${fmt}`);
    }
  }

  async function load() {
    const { watch } = await chrome.storage.local.get('watch');
    if (!watch || watch.origin !== location.origin) {
      cfg = null;
      badge?.remove();
      badge = null;
      return;
    }
    if (!cfg || cfg.pickedAt !== watch.pickedAt) {
      sent = null;
      firstAfterPick = Date.now() - (watch.pickedAt || 0) < 60000;
    }
    cfg = watch;
    if (!cfg.enabled) showBadge('пауза', false);
  }

  chrome.storage.onChanged.addListener((ch) => {
    if (ch.watch) load();
  });

  load().then(() => {
    setInterval(tick, TICK);
    // Пульс «я на рабочей странице» — администратор видит, что сотрудник онлайн.
    const ping = () => cfg?.enabled && chrome.runtime.sendMessage({ type: 'ping', page: location.href }).catch(() => {});
    ping();
    setInterval(ping, 60000);
  });
})();
