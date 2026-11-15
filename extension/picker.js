// Режим выбора: подсвечивает элементы под курсором, по клику запоминает сумму прибыли.
(() => {
  if (window.__smenyPicker) return;
  window.__smenyPicker = true;

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

  // Классы, похожие на сгенерированные (css-1x2y3z, sc-abc, Button_root__a1b2c) — в селектор не берём.
  const unstable = (c) => /\d{3,}|^css-|^sc-|^jsx-|__[\w-]{5,}$|^_[\w-]{5,}$|[A-Z].*\d/.test(c);

  function part(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && !/\d{3,}/.test(el.id) && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return { sel: `#${CSS.escape(el.id)}`, unique: true };
    }
    for (const a of ['data-testid', 'data-test', 'data-qa', 'data-id', 'name', 'aria-label']) {
      const v = el.getAttribute(a);
      if (v && v.length < 60) return { sel: `${tag}[${a}="${CSS.escape(v)}"]` };
    }
    const cls = [...el.classList].filter((c) => !unstable(c)).slice(0, 2);
    let sel = tag + cls.map((c) => `.${CSS.escape(c)}`).join('');
    const parent = el.parentElement;
    if (parent) {
      const same = [...parent.children].filter((x) => x.tagName === el.tagName);
      if (same.length > 1) sel += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    return { sel };
  }

  function selectorFor(el) {
    const chain = [];
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const p = part(cur);
      chain.unshift(p.sel);
      const s = chain.join(' > ');
      try {
        if (document.querySelectorAll(s).length === 1 && document.querySelector(s) === el) return s;
      } catch {}
      if (p.unique) break;
      cur = cur.parentElement;
    }
    return chain.join(' > ');
  }

  // Берём самый «внутренний» элемент с числом.
  function numericTarget(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      if (parseMoney(cur.innerText) !== null && (cur.innerText || '').length < 80) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #10b981;background:rgba(16,185,129,.12);border-radius:6px;transition:all .06s;display:none';
  const tip = document.createElement('div');
  tip.style.cssText =
    'position:fixed;z-index:2147483647;left:50%;top:16px;transform:translateX(-50%);background:#0b1220;color:#fff;font:500 14px/1.4 system-ui,sans-serif;' +
    'padding:10px 16px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);max-width:90vw;text-align:center';
  tip.textContent = '💧 Наведите на сумму прибыли и кликните по ней. Esc — отмена';
  document.documentElement.append(box, tip);

  let current = null;
  function onMove(e) {
    const t = numericTarget(e.target);
    current = t;
    if (!t) {
      box.style.display = 'none';
      return;
    }
    const r = t.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    box.remove();
    setTimeout(() => tip.remove(), 2500);
    window.__smenyPicker = false;
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!current) return;
    const selector = selectorFor(current);
    const value = parseMoney(current.innerText);
    const sample = (current.innerText || '').trim().slice(0, 60);
    chrome.runtime.sendMessage({ type: 'picked', selector, sample, value, origin: location.origin });
    tip.textContent = `✅ Готово! Слежу за суммой «${sample}». Изменения будут отправляться автоматически.`;
    tip.style.background = '#047857';
    cleanup();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      tip.textContent = 'Выбор отменён';
      cleanup();
    }
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
})();
