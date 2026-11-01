'use strict';
const t = (k, s) => chrome.i18n.getMessage(k, s) || k;
const $ = (s) => document.querySelector(s);

let settings = Object.assign({}, HUSH.DEFAULTS);
let ui = Object.assign({}, HUSH.UI_DEFAULTS);
let diag = [];
let faultDetail = '';
let rt = { mode: 'off', mutedByUs: {}, recent: {} };
let hasTabs = false;
let shortcuts = {};
let listSeq = 0;

/* Ask the background worker to do something. If it can't be reached, say so on screen
   instead of failing silently; `fallback` lets simple actions still work. */
async function send(msg, fallback) {
  try {
    const r = await chrome.runtime.sendMessage(msg);
    if (!r || r.ok === false) throw new Error((r && r.error) || 'no response');
    faultDetail = '';
  } catch (e) {
    faultDetail = e && e.message ? e.message : String(e);
    if (fallback) { try { await fallback(); } catch (_) { /* ignore */ } }
  }
  renderFault();
}
function renderFault() {
  const parts = [];
  if (faultDetail) parts.push(faultDetail);
  if (diag.length) parts.push(t('faultMissing', [diag.join(', ')]));
  $('#fault').hidden = parts.length === 0;
  $('#faultDetail').textContent = parts.join(' · ');
}

function localize() {
  document.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach((e) => { e.setAttribute('aria-label', t(e.dataset.i18nAria)); });
}

async function loadState() {
  const d = await chrome.storage.local.get(['settings', 'rt', 'ui', 'diag']);
  settings = Object.assign({}, HUSH.DEFAULTS, d.settings || {});
  ui = Object.assign({}, HUSH.UI_DEFAULTS, d.ui || {});
  diag = Array.isArray(d.diag) ? d.diag : [];
  rt = Object.assign({ mode: 'off', mutedByUs: {}, recent: {} }, d.rt || {});
}
async function loadShortcuts() {
  const cmds = await chrome.commands.getAll();
  shortcuts = {};
  cmds.forEach((c) => { shortcuts[c.name] = c.shortcut || ''; });
}
async function checkPerm() {
  hasTabs = await chrome.permissions.contains({ permissions: ['tabs'] });
}

function render() {
  const state = HUSH.stateKey(settings, rt);
  HUSH.applyTheme(ui.theme);
  renderFault();

  const pill = $('#statePill');
  pill.textContent = t('pill_' + state);
  pill.dataset.state = state;

  $('#btnSolo').setAttribute('aria-pressed', String(rt.mode === 'solo' && !settings.paused));
  $('#btnAll').setAttribute('aria-pressed', String(rt.mode === 'all' && !settings.paused));
  $('#kSolo').textContent = shortcuts['toggle-solo'] || '';
  $('#kAll').textContent = shortcuts['toggle-all'] || '';
  $('#swFollow').checked = !!settings.autoFollow;
  $('#swPause').checked = !!settings.paused;
  $('#followNote').hidden = !(settings.autoFollow && rt.mode !== 'off' && !settings.paused);
  $('#permCard').hidden = hasTabs;

  const tip = $('#tip');
  tip.hidden = !!ui.tipSeen;
  $('#tipText').textContent = shortcuts['toggle-solo']
    ? t('tipText', [shortcuts['toggle-solo']])
    : t('tipNoKey');

  renderList();
}

/* ---- tab list (built with textContent only, so page titles can never inject markup) */
const SVG_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9a4 4 0 0 1 0 6"/></svg>';
const SVG_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';

function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }

function buildRow(tab, winNo, currentWinId) {
  const muted = !!(tab.mutedInfo && tab.mutedInfo.muted);
  const heard = tab.audible && !muted;
  const li = el('li', 'row' + (heard ? ' heard' : ''));

  const main = el('button', 'row-main');
  main.type = 'button';
  main.title = t('jumpToTab');

  const fav = tab.favIconUrl ? el('img', 'fav') : el('span', 'fav');
  if (tab.favIconUrl) {
    fav.alt = ''; fav.src = tab.favIconUrl;
    fav.addEventListener('error', () => { fav.removeAttribute('src'); fav.style.visibility = 'hidden'; });
  }
  main.appendChild(fav);

  const text = el('span', 'row-text');
  const title = el('span', 'row-title');
  title.textContent = tab.title || t('tabFallback', [String(tab.index + 1), String(winNo)]);
  const sub = el('span', 'row-sub');
  if (heard) { const eq = el('span', 'eq'); eq.append(el('i'), el('i'), el('i')); eq.setAttribute('aria-hidden', 'true'); sub.appendChild(eq); }
  let status = muted ? (rt.mutedByUs[tab.id] ? t('mutedByHush') : t('mutedLabel')) : (tab.audible ? t('playingLabel') : t('quietLabel'));
  if (tab.active && tab.windowId === currentWinId) status += ' · ' + t('thisTab');
  sub.appendChild(document.createTextNode(status));
  text.append(title, sub);
  main.appendChild(text);
  main.addEventListener('click', async () => {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    window.close();
  });

  const btn = el('button', 'mute');
  btn.type = 'button';
  btn.setAttribute('aria-pressed', String(muted));
  btn.title = muted ? t('unmuteTab') : t('muteTab');
  btn.setAttribute('aria-label', btn.title);
  btn.innerHTML = muted ? SVG_OFF : SVG_ON;     // static markup, no page data
  btn.addEventListener('click', () => send({ type: 'toggleTab', tabId: tab.id }, () => chrome.tabs.update(tab.id, { muted: !muted })));

  li.append(main, btn);
  return li;
}

async function renderList() {
  const seq = ++listSeq;
  const [tabs, win] = await Promise.all([chrome.tabs.query({}), chrome.windows.getCurrent()]);
  if (seq !== listSeq) return;
  const winOrder = [...new Set(tabs.map((x) => x.windowId))].sort((a, b) => a - b);
  const now = Date.now();
  const recentTs = rt.recent || {};

  const playing = tabs.filter((x) => x.audible);
  const recent = tabs
    .filter((x) => !x.audible && recentTs[x.id] && now - recentTs[x.id] < HUSH.RECENT_MS)
    .sort((a, b) => recentTs[b.id] - recentTs[a.id]);

  const fill = (ul, arr) => {
    ul.replaceChildren(...arr.map((x) => buildRow(x, winOrder.indexOf(x.windowId) + 1, win.id)));
  };
  fill($('#playing'), playing);
  fill($('#recent'), recent);
  $('#playingEmpty').hidden = playing.length > 0;
  $('#recentHead').hidden = recent.length === 0;
}

/* ---- wiring */
function bind() {
  $('#btnSolo').addEventListener('click', () => send({ type: 'toggleMode', mode: 'solo' }));
  $('#btnAll').addEventListener('click', () => send({ type: 'toggleMode', mode: 'all' }));
  $('#swFollow').addEventListener('change', (e) => send({ type: 'setSetting', key: 'autoFollow', value: e.target.checked }));
  $('#swPause').addEventListener('change', (e) => send({ type: 'setSetting', key: 'paused', value: e.target.checked }));
  $('#restore').addEventListener('click', () => send({ type: 'restoreAll' }));
  $('#openSettings').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });
  $('#tipClose').addEventListener('click', () => HUSH.saveUi({ tipSeen: true }));
  $('#grantTabs').addEventListener('click', async () => {
    try { await chrome.permissions.request({ permissions: ['tabs'] }); } catch (e) { /* dismissed */ }
    await checkPerm(); render();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.settings || changes.rt || changes.ui || changes.diag)) return;
    loadState().then(render);
  });
  let timer = null;
  const soon = () => { clearTimeout(timer); timer = setTimeout(renderList, 80); };
  chrome.tabs.onUpdated.addListener((id, change) => { if ('audible' in change || 'mutedInfo' in change || 'title' in change) soon(); });
  chrome.tabs.onRemoved.addListener(soon);
  chrome.tabs.onCreated.addListener(soon);
  chrome.permissions.onAdded.addListener(() => checkPerm().then(render));
  chrome.permissions.onRemoved.addListener(() => checkPerm().then(render));
}

(async function init() {
  localize();
  await Promise.all([loadState(), loadShortcuts(), checkPerm()]);
  bind();
  render();
  send({ type: 'ping' });
})();
