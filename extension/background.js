// Фоновый процесс: принимает показания со страницы, отправляет их на сервер (с очередью при обрыве связи)
// и показывает сегодняшнюю прибыль на значке.

const WATCHER_ID = 'smeny-watcher';

async function getState() {
  return chrome.storage.local.get(['server', 'token', 'watch', 'queue', 'status']);
}

async function call(path, body) {
  const { server, token } = await getState();
  if (!server || !token) throw new Error('Расширение не подключено');
  const res = await fetch(`${server}/api/ext${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error(data?.error || `Ошибка сервера (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function short(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
}

async function setStatus(patch) {
  const { status } = await getState();
  const next = { ...(status || {}), ...patch, at: Date.now() };
  await chrome.storage.local.set({ status: next });
  if (next.error) {
    chrome.action.setBadgeBackgroundColor({ color: '#e11d48' });
    chrome.action.setBadgeText({ text: '!' });
  } else if (next.today) {
    chrome.action.setBadgeBackgroundColor({ color: '#059669' });
    chrome.action.setBadgeText({ text: next.today.profit ? short(next.today.profit) : '' });
  }
}

// Очередь: показания не теряются, если интернет пропал.
let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const { queue = [] } = await getState();
      if (!queue.length) break;
      const item = queue[0];
      try {
        const data = await call('/reading', item);
        await setStatus({ today: data.today, user: data.user, error: null, lastSent: { value: item.value, added: data.added, at: Date.now() } });
      } catch (e) {
        if (!e.status || e.status >= 500 || e.status === 429) {
          await setStatus({ error: 'Нет связи с сервером — показания сохранены и будут отправлены позже' });
          break;
        }
        await setStatus({ error: e.message });
      }
      const { queue: q2 = [] } = await getState();
      await chrome.storage.local.set({ queue: q2.slice(1) });
    }
  } finally {
    flushing = false;
  }
}

async function registerWatcher(origin) {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [WATCHER_ID] });
  } catch {}
  if (!origin) return;
  await chrome.scripting.registerContentScripts([
    { id: WATCHER_ID, matches: [`${origin}/*`], js: ['watcher.js'], runAt: 'document_idle', persistAcrossSessions: true },
  ]);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    const { watch } = await getState();
    if (msg.type === 'reading') {
      if (!watch?.enabled) return reply({ ok: false });
      const { queue = [] } = await getState();
      queue.push({
        value: msg.value,
        mode: watch.mode || 'counter',
        page: msg.page,
        reset: Boolean(msg.reset),
        clientId: crypto.randomUUID(),
      });
      await chrome.storage.local.set({ queue: queue.slice(-500) });
      await flush();
      return reply({ ok: true });
    }
    if (msg.type === 'ping') {
      try {
        const data = await call('/ping', { page: msg.page });
        await setStatus({ today: data.today, user: data.user, error: null });
      } catch (e) {
        await setStatus({ error: e.message });
      }
      flush();
      return reply({ ok: true });
    }
    if (msg.type === 'picked') {
      const next = {
        origin: msg.origin,
        selector: msg.selector,
        sample: msg.sample,
        mode: watch?.mode || 'counter',
        enabled: true,
        badge: watch?.badge ?? true,
        pickedAt: Date.now(),
      };
      await chrome.storage.local.set({ watch: next });
      await registerWatcher(msg.origin);
      if (sender.tab?.id) {
        await chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, files: ['watcher.js'] }).catch(() => {});
      }
      return reply({ ok: true });
    }
    if (msg.type === 'unwatch') {
      await chrome.storage.local.remove('watch');
      await registerWatcher(null);
      return reply({ ok: true });
    }
    if (msg.type === 'refresh') {
      try {
        const data = await call('/ping', {});
        await setStatus({ today: data.today, user: data.user, error: null });
        reply({ ok: true, data });
      } catch (e) {
        await setStatus({ error: e.message });
        reply({ ok: false, error: e.message });
      }
      return;
    }
    reply({ ok: false });
  })();
  return true;
});

chrome.alarms.create('flush', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'flush') flush();
});

chrome.runtime.onInstalled.addListener(async () => {
  const { watch } = await getState();
  if (watch?.origin) registerWatcher(watch.origin).catch(() => {});
});
