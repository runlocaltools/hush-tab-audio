'use strict';
/* Shared by the service worker (importScripts) and the extension pages. */
var HUSH = {
  /* Worker settings: changed through the background worker. */
  DEFAULTS: {
    autoFollow: false,
    graceMs: 1000,
    scope: 'perWindow',   // 'perWindow' | 'focused'
    pinnedExempt: true,
    muteSilent: true,
    badge: true,
    paused: false
  },
  /* Page-only preferences: written straight to storage by the pages, no worker needed. */
  UI_DEFAULTS: { theme: 'system', tipSeen: false },
  RECENT_MS: 10 * 60 * 1000,
  validators: {
    autoFollow: function (v) { return typeof v === 'boolean'; },
    graceMs: function (v) { return Number.isInteger(v) && v >= 0 && v <= 5000; },
    scope: function (v) { return v === 'perWindow' || v === 'focused'; },
    pinnedExempt: function (v) { return typeof v === 'boolean'; },
    muteSilent: function (v) { return typeof v === 'boolean'; },
    badge: function (v) { return typeof v === 'boolean'; },
    paused: function (v) { return typeof v === 'boolean'; }
  },
  uiValidators: {
    theme: function (v) { return v === 'system' || v === 'light' || v === 'dark'; },
    tipSeen: function (v) { return typeof v === 'boolean'; }
  },
  stateKey: function (settings, rt) {
    if (settings.paused) return 'paused';
    if (rt && rt.mode && rt.mode !== 'off') return rt.mode;
    return settings.autoFollow ? 'follow' : 'off';
  },
  loadUi: async function () {
    const d = await chrome.storage.local.get('ui');
    return Object.assign({}, HUSH.UI_DEFAULTS, d.ui || {});
  },
  saveUi: async function (patch) {
    const cur = await HUSH.loadUi();
    for (const k of Object.keys(patch)) if (HUSH.uiValidators[k] && HUSH.uiValidators[k](patch[k])) cur[k] = patch[k];
    await chrome.storage.local.set({ ui: cur });
    return cur;
  },
  applyTheme: function (theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }
};
