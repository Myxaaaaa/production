const $ = (id) => document.getElementById(id);
const fmt = (n) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n ?? 0)} сом`;
const store = chrome.storage.local;

async function api(path, body) {
  const { server, token } = await store.get(['server', 'token']);
  const res = await fetch(`${server}/api/ext${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Ошибка сервера (${res.status})`);
  return data;
}

function showError(text) {
  $('err').hidden = !text;
  $('err').textContent = text || '';
}

async function render() {
  const { server, token, watch, status } = await store.get(['server', 'token', 'watch', 'status']);
  const connected = Boolean(server && token);
  $('connect').hidden = connected;
  $('main').hidden = !connected;
  if (!connected) return;

  $('open').href = server;
  $('name').textContent = status?.user?.name || '…';
  const t = status?.today;
  $('profit').textContent = t ? fmt(t.profit) : '—';
  $('goal').textContent = t?.goal ? `Цель: ${fmt(t.goal)}` : 'Цель не задана';
  $('earned').textContent = t ? `Заработано: ${fmt(t.earned)}` : '';
  $('goalBar').style.width = t?.goal ? `${Math.min(100, (t.profit / t.goal) * 100)}%` : '0';

  $('watchNone').hidden = Boolean(watch);
  $('watchOn').hidden = !watch;
  if (watch) {
    $('site').textContent = new URL(watch.origin).host;
    $('sample').textContent = `сумма на странице: «${watch.sample}»`;
    $('mode').value = watch.mode || 'counter';
    $('enabled').checked = watch.enabled !== false;
    $('badge').checked = watch.badge !== false;
  }
  showError(status?.error);
  const dot = $('dot');
  dot.className = `dot ${status?.error ? 'err' : status?.at && Date.now() - status.at < 180000 ? 'on' : ''}`;
  const l = status?.lastSent;
  $('last').textContent = l
    ? `Последнее показание ${fmt(l.value)} в ${new Date(l.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}${l.added ? ` · +${fmt(l.added)}` : ''}`
    : '';
}

$('connectBtn').onclick = async () => {
  const raw = $('code').value.trim();
  const m = /^(https?:\/\/[^#\s]+)#(smn_[\w-]{20,})$/.exec(raw);
  if (!m) return alert('Код не похож на код подключения. Скопируйте его целиком из приложения.');
  const server = new URL(m[1]).origin;
  const granted = await chrome.permissions.request({ origins: [`${server}/*`] });
  if (!granted) return alert('Без доступа к адресу приложения расширение не сможет отправлять прибыль.');
  $('connectBtn').disabled = true;
  try {
    await store.set({ server, token: m[2] });
    const data = await api('/hello');
    await store.set({ status: { user: data.user, today: data.today, error: null, at: Date.now() } });
  } catch (e) {
    await store.remove(['server', 'token']);
    alert(e.message);
  } finally {
    $('connectBtn').disabled = false;
    render();
  }
};

async function pick() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) return alert('Откройте рабочий сайт в этой вкладке и нажмите ещё раз.');
  const origin = new URL(tab.url).origin;
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) return alert('Нужно разрешить доступ к этому сайту, чтобы следить за суммой.');
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['picker.js'] });
  window.close();
}
$('pick').onclick = pick;
$('repick').onclick = pick;

$('unwatch').onclick = async () => {
  if (!confirm('Перестать следить за суммой на этом сайте?')) return;
  await chrome.runtime.sendMessage({ type: 'unwatch' });
  render();
};

async function patchWatch(p) {
  const { watch } = await store.get('watch');
  if (watch) await store.set({ watch: { ...watch, ...p } });
}
$('mode').onchange = (e) => patchWatch({ mode: e.target.value });
$('enabled').onchange = (e) => patchWatch({ enabled: e.target.checked });
$('badge').onchange = (e) => patchWatch({ badge: e.target.checked });

$('add').onclick = async () => {
  const amount = $('amount').value.trim();
  if (!amount) return $('amount').focus();
  $('add').disabled = true;
  try {
    const data = await api('/profit', { amount, note: $('note').value.trim() });
    await store.set({ status: { ...(await store.get('status')).status, today: data.today, error: null, at: Date.now() } });
    $('amount').value = '';
    $('note').value = '';
  } catch (e) {
    alert(e.message);
  } finally {
    $('add').disabled = false;
    render();
  }
};

$('logout').onclick = async () => {
  if (!confirm('Отключить расширение от приложения? Код подключения придётся ввести заново.')) return;
  await chrome.runtime.sendMessage({ type: 'unwatch' });
  await store.clear();
  chrome.action.setBadgeText({ text: '' });
  render();
};

chrome.storage.onChanged.addListener(render);
render();
chrome.runtime.sendMessage({ type: 'refresh' }).then(render, () => {});
