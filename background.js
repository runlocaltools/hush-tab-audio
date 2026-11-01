'use strict';
importScripts('shared.js');

/* ------------------------------------------------------------------ state
   settings  – user choices (storage.local → "settings")
   rt        – what Hush is doing right now (storage.local → "rt")
     mode       'off' | 'solo' (mute others) | 'all'
     mutedByUs  { tabId: true }  tabs THIS extension muted (the only ones it will ever unmute)
     override   { tabId: 'muted'|'unmuted' }  manual choices that beat automatic rules
     solo       { tabId: true }  tabs kept audible while mode === 'solo'
     lastActive { windowId: tabId }
     recent     { tabId: timestamp }  last time a tab made sound
------------------------------------------------------------------------- */
let settings = Object.assign({}, HUSH.DEFAULTS);
let rt = freshRuntime();
const grace = new Map();           // tabId -> timeout id (tab you just left keeps playing briefly)
let lastIconState = null;

function freshRuntime() {
  return { mode: 'off', mutedByUs: {}, override: {}, solo: {}, lastActive: {}, recent: {} };
}
async function load() {
  const d = await chrome.storage.local.get(['settings', 'rt']);
  settings = Object.assign({}, HUSH.DEFAULTS);
  const saved = d.settings || {};
  for (const k of Object.keys(HUSH.DEFAULTS)) if (HUSH.validators[k](saved[k])) settings[k] = saved[k];
  rt = Object.assign(freshRuntime(), d.rt || {});
}
function persist() { return chrome.storage.local.set({ settings: settings, rt: rt }); }
const ready = load();

/* Run everything one at a time so overlapping browser events can't fight each other. */
let chain = Promise.resolve();
function run(fn) {
  const p = chain.then(fn);
  chain = p.catch(function (e) { console.error('[Hush]', e); });
  return p;
}

/* ---------------------------------------------------------------- decision */
/* Returns true = should be muted by Hush, false = should be left alone/restored,
   null = the user decided manually, don't touch. */
function decide(tab, focusedWindowId) {
  const id = tab.id;
  if (settings.paused) return false;
  if (rt.override[id]) return null;

  let target;
  if (rt.mode === 'all') {
    target = true;
  } else if (rt.mode === 'solo') {
    target = !rt.solo[id];
  } else if (settings.autoFollow) {
    const isCurrent = settings.scope === 'focused'
      ? (tab.active && tab.windowId === focusedWindowId)
      : tab.active;
    target = !isCurrent;
    if (target && settings.pinnedExempt && tab.pinned) target = false;
    if (target && grace.has(id)) target = false;
  } else {
    return false;
  }
  // "Only mute tabs that make sound": skip silent tabs unless we already muted them.
  if (target && !settings.muteSilent && !tab.audible && !rt.mutedByUs[id]) target = false;
  return target;
}

async function reconcile() {
  await ready;
  const results = await Promise.all([
    chrome.tabs.query({}),
    chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(function () { return null; })
  ]);
  const tabs = results[0];
  const focusedId = results[1] ? results[1].id : null;
  const present = new Set();
  const windows = new Set();

  for (const tab of tabs) {
    if (tab.id == null) continue;
    present.add(tab.id);
    windows.add(tab.windowId);
    if (tab.active && rt.lastActive[tab.windowId] == null) rt.lastActive[tab.windowId] = tab.id;

    const want = decide(tab, focusedId);
    if (want === null) continue;
    const muted = !!(tab.mutedInfo && tab.mutedInfo.muted);
    const ours = !!rt.mutedByUs[tab.id];
    try {
      if (want && !muted) {
        await chrome.tabs.update(tab.id, { muted: true });
        rt.mutedByUs[tab.id] = true;
      } else if (!want && ours) {
        if (muted) await chrome.tabs.update(tab.id, { muted: false });
        delete rt.mutedByUs[tab.id];
      }
      // want && muted (by the user or someone else): leave it, and never claim it.
    } catch (e) { /* tab closed mid-way */ }
  }

  for (const k of Object.keys(rt.mutedByUs)) if (!present.has(+k)) delete rt.mutedByUs[k];
  for (const k of Object.keys(rt.override)) if (!present.has(+k)) delete rt.override[k];
  for (const k of Object.keys(rt.solo)) if (!present.has(+k)) delete rt.solo[k];
  for (const k of Object.keys(rt.lastActive)) if (!windows.has(+k)) delete rt.lastActive[k];
  const cutoff = Date.now() - HUSH.RECENT_MS;
  for (const k of Object.keys(rt.recent)) if (!present.has(+k) || rt.recent[k] < cutoff) delete rt.recent[k];

  await persist();
  await refreshAction(tabs);
}

/* ------------------------------------------------------------ toolbar icon */
const ICON_COLORS = { off: '#2a2930', follow: '#ff5c39', solo: '#1f9d55', all: '#b3261e', paused: '#9a9c9f' };

function drawIcon(size, state) {
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d');
  const k = size / 32, r = 7 * k;
  g.fillStyle = ICON_COLORS[state] || ICON_COLORS.off;
  g.beginPath();
  g.moveTo(r, 0); g.arcTo(size, 0, size, size, r); g.arcTo(size, size, 0, size, r);
  g.arcTo(0, size, 0, 0, r); g.arcTo(0, 0, size, 0, r); g.closePath(); g.fill();

  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = 2.2 * k;
  g.beginPath();
  g.moveTo(7 * k, 12.5 * k); g.lineTo(11.5 * k, 12.5 * k); g.lineTo(17 * k, 7.5 * k);
  g.lineTo(17 * k, 24.5 * k); g.lineTo(11.5 * k, 19.5 * k); g.lineTo(7 * k, 19.5 * k);
  g.closePath(); g.fill();

  if (state === 'all' || state === 'paused') {
    g.strokeStyle = ICON_COLORS[state]; g.lineWidth = 5.4 * k;
    g.beginPath(); g.moveTo(5 * k, 5 * k); g.lineTo(27 * k, 27 * k); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 2.6 * k;
    g.beginPath(); g.moveTo(5 * k, 5 * k); g.lineTo(27 * k, 27 * k); g.stroke();
  } else {
    g.beginPath(); g.arc(17 * k, 16 * k, 6 * k, -0.85, 0.85); g.stroke();
    g.beginPath(); g.arc(17 * k, 16 * k, 10 * k, -0.85, 0.85); g.stroke();
  }
  return g.getImageData(0, 0, size, size);
}

async function refreshAction(knownTabs) {
  try {
    const tabs = knownTabs || await chrome.tabs.query({ audible: true });
    const heard = tabs.filter(function (t) { return t.audible && !(t.mutedInfo && t.mutedInfo.muted); }).length;
    const state = HUSH.stateKey(settings, rt);
    const text = settings.badge && heard > 0 ? String(heard) : '';
    await chrome.action.setBadgeText({ text: text });
    await chrome.action.setBadgeBackgroundColor({ color: ICON_COLORS[state] === ICON_COLORS.off ? '#5f6265' : ICON_COLORS[state] });
    if (state !== lastIconState) {
      await chrome.action.setIcon({ imageData: { 16: drawIcon(16, state), 32: drawIcon(32, state) } });
      await chrome.action.setTitle({ title: chrome.i18n.getMessage('state_' + state) });
      lastIconState = state;
    }
  } catch (e) { /* action not ready yet */ }
}

/* ----------------------------------------------------------------- actions */
function clearGrace() { grace.forEach(function (t) { clearTimeout(t); }); grace.clear(); }
function startGrace(id) {
  if (grace.has(id)) clearTimeout(grace.get(id));
  grace.set(id, setTimeout(function () { grace.delete(id); run(reconcile); }, settings.graceMs));
}

async function captureSolo() {
  const results = await Promise.all([
    chrome.tabs.query({ active: true }),
    chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(function () { return null; })
  ]);
  for (const t of results[0]) {
    if (settings.scope === 'focused' && results[1] && t.windowId !== results[1].id) continue;
    rt.solo[t.id] = true;
  }
}

async function setMode(next) {
  if (next !== 'off' && next !== 'solo' && next !== 'all') return;
  settings.paused = false;
  clearGrace();
  rt.override = {}; rt.solo = {}; rt.mode = next;
  if (next === 'solo') await captureSolo();
  await reconcile();
}
function toggleMode(mode) { return setMode(rt.mode === mode ? 'off' : mode); }

/* "Put everything back": only unmutes tabs Hush muted; tabs you muted stay muted. */
async function restoreAll() {
  clearGrace();
  rt.mode = 'off'; rt.override = {}; rt.solo = {};
  settings.autoFollow = false; settings.paused = false;
  await reconcile();
}

const REARM = { autoFollow: 1, scope: 1, pinnedExempt: 1, muteSilent: 1 };
async function setSetting(key, value) {
  const ok = HUSH.validators[key];
  if (!ok || !ok(value)) return;
  settings[key] = value;
  if (REARM[key]) { rt.override = {}; clearGrace(); }
  if (key === 'autoFollow' && value) settings.paused = false;
  await reconcile();
}
async function resetSettings() {
  settings = Object.assign({}, HUSH.DEFAULTS);
  clearGrace(); rt.override = {}; rt.mode = 'off'; rt.solo = {};
  await reconcile();
}

/* A manual click on one tab always wins over automatic rules. */
async function toggleTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  const tab = await chrome.tabs.get(tabId).catch(function () { return null; });
  if (!tab) return;
  const muted = !!(tab.mutedInfo && tab.mutedInfo.muted);
  await chrome.tabs.update(tabId, { muted: !muted });
  delete rt.mutedByUs[tabId];               // now it's the user's choice, not ours to undo
  rt.override[tabId] = muted ? 'unmuted' : 'muted';
  await persist();
  await refreshAction();
}

async function handleMessage(msg) {
  await ready;
  switch (msg && msg.type) {
    case 'toggleMode': await toggleMode(msg.mode); break;
    case 'setSetting': await setSetting(msg.key, msg.value); break;
    case 'restoreAll': await restoreAll(); break;
    case 'toggleTab': await toggleTab(msg.tabId); break;
    case 'resetSettings': await resetSettings(); break;
    case 'ping': break;
    default: return { ok: false };
  }
  return { ok: true };
}

/* Register an event listener without ever crashing the worker. Anything Chrome doesn't
   expose is recorded in storage ("diag") so the popup can show exactly what is missing. */
const diag = [];
function on(path, fn) {
  try {
    let o = chrome;
    for (const p of path.split('.')) o = o && o[p];
    if (o && typeof o.addListener === 'function') o.addListener(fn);
    else { diag.push('chrome.' + path); console.error('[Hush] event not available: chrome.' + path); }
  } catch (e) {
    diag.push('chrome.' + path + ' (' + e.message + ')');
    console.error('[Hush] could not register chrome.' + path, e);
  }
}

/* ------------------------------------------------------------------ events
   All listeners are registered synchronously at the top level (MV3 requirement). */
on('runtime.onMessage', function (msg, sender, sendResponse) {
  if (sender.id !== chrome.runtime.id) return;
  run(function () { return handleMessage(msg); })
    .then(sendResponse)
    .catch(function (e) { sendResponse({ ok: false, error: String(e) }); });
  return true;
});

on('commands.onCommand', function (cmd) {
  run(async function () {
    await ready;
    if (cmd === 'toggle-solo') await toggleMode('solo');
    else if (cmd === 'toggle-all') await toggleMode('all');
    else if (cmd === 'toggle-follow') await setSetting('autoFollow', !settings.autoFollow);
  });
});

on('tabs.onActivated', function (info) {
  run(async function () {
    await ready;
    const prev = rt.lastActive[info.windowId];
    rt.lastActive[info.windowId] = info.tabId;
    delete rt.override[info.tabId];                       // a tab you open is fresh again
    if (grace.has(info.tabId)) { clearTimeout(grace.get(info.tabId)); grace.delete(info.tabId); }
    if (settings.autoFollow && rt.mode === 'off' && !settings.paused &&
        prev != null && prev !== info.tabId && settings.graceMs > 0) {
      startGrace(prev);
    }
    await reconcile();
  });
});

on('tabs.onUpdated', function (tabId, change) {
  run(async function () {
    await ready;
    if (change.audible === true) rt.recent[tabId] = Date.now();
    const mi = change.mutedInfo;
    if (mi && mi.reason === 'user') {                     // user used Chrome's own mute control
      delete rt.mutedByUs[tabId];
      rt.override[tabId] = mi.muted ? 'muted' : 'unmuted';
      await persist(); await refreshAction();
      return;
    }
    if (mi && mi.reason === 'extension') { await refreshAction(); return; }   // our own change
    if (change.audible !== undefined || change.pinned !== undefined || mi) await reconcile();
  });
});

on('tabs.onCreated', function () { run(reconcile); });
on('tabs.onAttached', function () { run(reconcile); });
on('tabs.onDetached', function () { run(reconcile); });
on('tabs.onRemoved', function (tabId) {
  run(async function () {
    await ready;
    delete rt.mutedByUs[tabId]; delete rt.override[tabId]; delete rt.solo[tabId]; delete rt.recent[tabId];
    if (grace.has(tabId)) { clearTimeout(grace.get(tabId)); grace.delete(tabId); }
    await persist(); await refreshAction();
  });
});
on('windows.onFocusChanged', function (winId) {
  if (winId === chrome.windows.WINDOW_ID_NONE) return;
  run(reconcile);
});
on('windows.onRemoved', function (winId) {
  run(async function () { await ready; delete rt.lastActive[winId]; await persist(); });
});

/* Tab ids are reused after a full browser restart, so Hush starts clean then. */
on('runtime.onStartup', function () {
  run(async function () { await ready; rt = freshRuntime(); lastIconState = null; await reconcile(); });
});
on('runtime.onInstalled', function () {
  run(async function () { await ready; lastIconState = null; await reconcile(); });
});

/* Cold start of the worker (it sleeps when idle): make sure the toolbar is right. */
ready.then(function () { run(reconcile); });

/* Tell the pages this worker started, and which events (if any) it could not attach to. */
try { chrome.storage.local.set({ diag: diag, workerSeen: { version: chrome.runtime.getManifest().version, at: Date.now() } }); } catch (e) {}
