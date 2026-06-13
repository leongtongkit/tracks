// Consent module — TE-industrial skin shared by tracks + synth.
// jfound.net zone runs Cloudflare Zaraz with Consent Management: GA4 is
// bound to an Analytics purpose at the edge and stays silent until consent
// is set. This module suppresses Zaraz's default modal (visually foreign
// here) and renders a hardware-style panel instead; choices are mirrored
// into zaraz.consent. Same bridge logic as jfound.net's cookie.js.
(function () {
  'use strict';
  var KEY = 'jfound_cookie_consent';

  function readChoice() {
    try {
      var p = JSON.parse(localStorage.getItem(KEY) || 'null');
      return p && typeof p.analytics === 'boolean' ? p : null;
    } catch (_) { return null; }
  }
  function writeChoice(analytics) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 2, essential: true, analytics: analytics, savedAt: new Date().toISOString() }));
    } catch (_) {}
    applyToZaraz(analytics);
  }

  function whenReady(cb) {
    if (window.zaraz && window.zaraz.consent && window.zaraz.consent.APIReady) { cb(); return; }
    document.addEventListener('zarazConsentAPIReady', cb, { once: true });
  }
  function applyToZaraz(granted) {
    whenReady(function () {
      try {
        var c = window.zaraz.consent;
        try { if (c.modal) c.modal = false; } catch (_) {}
        var purposes = c.purposes || {};
        var ids = Object.keys(purposes);
        if (!ids.length) return;
        var hit = ids.filter(function (id) { return /analytic/i.test(JSON.stringify(purposes[id] && purposes[id].name || '')); });
        var grant = hit.length ? hit : ids;
        var prefs = {};
        ids.forEach(function (id) { prefs[id] = false; });
        grant.forEach(function (id) { prefs[id] = !!granted; });
        c.set(prefs);
        if (granted) c.sendQueuedEvents();
      } catch (_) {}
    });
  }

  // suppress the default modal: Zaraz auto-shows it AFTER API-ready, and
  // re-hiding an already-hidden modal throws — both quirks handled
  function suppress() {
    var hide = function () { try { if (window.zaraz.consent.modal) window.zaraz.consent.modal = false; } catch (_) {} };
    whenReady(hide);
    new MutationObserver(function () {
      var el = document.querySelector('.cf_modal_container');
      if (el && getComputedStyle(el).display !== 'none') hide();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  var CSS = '' +
    '#consent-mod{position:fixed;right:16px;bottom:16px;z-index:9999;width:272px;' +
      'background:var(--panel-grey,#eae9e4);border:1px solid var(--edge,#c4c3ba);' +
      'border-radius:var(--radius-md,6px);color:var(--ink,#1d1d1b);' +
      "font-family:var(--font-mono,'IBM Plex Mono',monospace);" +
      'box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 10px 28px rgba(0,0,0,.45);' +
      'animation:consent-in .28s var(--ease-snap,cubic-bezier(.2,.9,.3,1));}' +
    '@keyframes consent-in{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}' +
    '#consent-mod .cm-head{display:flex;align-items:center;gap:6px;padding:8px 10px 6px;' +
      'font-size:9px;font-weight:600;letter-spacing:.18em;border-bottom:1px dotted var(--edge,#c4c3ba);}' +
    '#consent-mod .cm-head i{width:7px;height:7px;background:var(--control,#2c2c2a);border-radius:1px;}' +
    '#consent-mod .cm-body{padding:8px 10px;font-size:10.5px;line-height:1.5;color:var(--ink-soft,#6e6d66);}' +
    '#consent-mod .cm-body a{color:var(--ink,#1d1d1b);}' +
    '#consent-mod .cm-row{display:flex;gap:6px;padding:0 10px 10px;}' +
    '#consent-mod button{flex:1;padding:7px 0;font:inherit;font-size:9.5px;font-weight:600;' +
      'letter-spacing:.14em;border-radius:var(--radius-sm,3px);cursor:pointer;}' +
    '#consent-mod .cm-no{background:var(--panel-lo,#d8d7d0);border:1px solid var(--edge,#c4c3ba);color:var(--ink,#1d1d1b);}' +
    '#consent-mod .cm-no:hover{background:var(--body-grey,#e2e1dc);}' +
    '#consent-mod .cm-yes{background:var(--control,#2c2c2a);border:1px solid var(--control,#2c2c2a);' +
      'color:var(--bone,#efeada);display:flex;align-items:center;justify-content:center;gap:6px;}' +
    '#consent-mod .cm-yes i{width:6px;height:6px;border-radius:50%;background:var(--led,#ff6a2b);' +
      'box-shadow:0 0 6px var(--led,#ff6a2b);}' +
    '#consent-mod .cm-yes:hover{border-color:var(--accent,#ff4d00);}';

  function showPanel() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var box = document.createElement('div');
    box.id = 'consent-mod';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Privacy');
    box.innerHTML =
      '<div class="cm-head"><i></i>PRIVACY</div>' +
      '<div class="cm-body">Allow anonymous analytics (GA4) and ads to keep Tracks free. ' +
      'Your music never leaves your device and is never collected or resold. ' +
      '<a href="https://jfound.net/privacy-notice" target="_blank" rel="noopener">Details</a></div>' +
      '<div class="cm-row">' +
      '<button type="button" class="cm-no">DECLINE</button>' +
      '<button type="button" class="cm-yes"><i></i>ALLOW</button>' +
      '</div>';
    box.querySelector('.cm-no').addEventListener('click', function () { writeChoice(false); box.remove(); });
    box.querySelector('.cm-yes').addEventListener('click', function () { writeChoice(true); box.remove(); });
    document.body.appendChild(box);
  }

  suppress();
  var saved = readChoice();
  if (saved) { applyToZaraz(saved.analytics); return; }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showPanel);
  else showPanel();
})();
