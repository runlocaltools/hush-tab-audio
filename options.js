'use strict';
const t = (k, s) => chrome.i18n.getMessage(k, s) || k;
const $ = (s) => document.querySelector(s);
async function send(msg) {
  try {
    const r = await chrome.runtime.sendMessage(msg);
    if (!r || r.ok === false) throw new Error((r && r.error) || 'no response');
    faultDetail = '';
  } catch (e) { faultDetail = e && e.message ? e.message : String(e); }
  renderFault();
}
function renderFault() {
  const parts = [];
  if (faultDetail) parts.push(faultDetail);
  if (diag.length) parts.push(t('faultMissing', [diag.join(', ')]));
  $('#fault').hidden = parts.length === 0;
  $('#faultDetail').textContent = parts.join(' · ');
}
let settings = Object.assign({}, HUSH.DEFAULTS);
let ui = Object.assign({}, HUSH.UI_DEFAULTS);
let diag = [];
let faultDetail = '';

function localize() {
  document.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  document.title = t('optTitle');
}

function paint() {
  HUSH.applyTheme(ui.theme);
  renderFault();
  $('#grace').value = settings.graceMs;
  $('#graceOut').textContent = t('optGraceValue', [String(settings.graceMs / 1000)]);
  document.querySelectorAll('input[name=scope]').forEach((r) => { r.checked = r.value === settings.scope; });
  $('#pinned').checked = settings.pinnedExempt;
  $('#silent').checked = settings.muteSilent;
  $('#badge').checked = settings.badge;
  $('#theme').value = ui.theme;
}

async function paintKeys() {
  const cmds = await chrome.commands.getAll();
  const box = $('#keys');
  box.replaceChildren();
  for (const c of cmds) {
    if (!c.description) continue;
    const row = document.createElement('div');
    const name = document.createElement('span'); name.textContent = c.description;
    const key = document.createElement('kbd'); key.textContent = c.shortcut || t('shortcutNotSet');
    row.append(name, key); box.appendChild(row);
  }
}

async function paintPerm() {
  const on = await chrome.permissions.contains({ permissions: ['tabs'] });
  $('#permStatus').textContent = t(on ? 'permStatusOn' : 'permStatusOff');
  $('#permOn').hidden = on;
  $('#permOff').hidden = !on;
}

function toast(msg) { const e = $('#toast'); e.textContent = msg; setTimeout(() => { e.textContent = ''; }, 2200); }
const set = (key, value) => send({ type: 'setSetting', key, value });

(async function init() {
  localize();
  const d = await chrome.storage.local.get(['settings', 'ui', 'diag']);
  settings = Object.assign({}, HUSH.DEFAULTS, d.settings || {});
  ui = Object.assign({}, HUSH.UI_DEFAULTS, d.ui || {});
  diag = Array.isArray(d.diag) ? d.diag : [];
  paint(); paintKeys(); paintPerm();

  $('#grace').addEventListener('input', (e) => { settings.graceMs = +e.target.value; paint(); });
  $('#grace').addEventListener('change', (e) => set('graceMs', +e.target.value));
  document.querySelectorAll('input[name=scope]').forEach((r) => r.addEventListener('change', () => set('scope', r.value)));
  $('#pinned').addEventListener('change', (e) => set('pinnedExempt', e.target.checked));
  $('#silent').addEventListener('change', (e) => set('muteSilent', e.target.checked));
  $('#badge').addEventListener('change', (e) => set('badge', e.target.checked));
  $('#theme').addEventListener('change', async (e) => { ui = await HUSH.saveUi({ theme: e.target.value }); paint(); });
  $('#changeKeys').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  $('#permOn').addEventListener('click', async () => { try { await chrome.permissions.request({ permissions: ['tabs'] }); } catch (e) {} paintPerm(); });
  $('#permOff').addEventListener('click', async () => { await chrome.permissions.remove({ permissions: ['tabs'] }); paintPerm(); });
  $('#reset').addEventListener('click', async () => { await send({ type: 'resetSettings' }); toast(t('resetDone')); });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.settings) settings = Object.assign({}, HUSH.DEFAULTS, ch.settings.newValue || {});
    if (ch.ui) ui = Object.assign({}, HUSH.UI_DEFAULTS, ch.ui.newValue || {});
    if (ch.diag) diag = Array.isArray(ch.diag.newValue) ? ch.diag.newValue : [];
    paint();
  });
  chrome.permissions.onAdded.addListener(paintPerm);
  chrome.permissions.onRemoved.addListener(paintPerm);
  window.addEventListener('focus', paintKeys);
  send({ type: 'ping' });
})();
