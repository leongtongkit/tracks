// ads.js — network-agnostic, consent-gated ad loader for tracks.jfound.net.
//
// HOW IT WORKS
//   • Every `.ad-slot` element in the page is a placeholder. Until ads are
//     configured below, they render as a labelled empty box (see site.css) and
//     load nothing — zero third-party requests, zero tracking.
//   • On /studio it also injects a small, dismissible corner unit (#ad-studio)
//     so the studio carries one tasteful slot without cluttering the chrome.
//   • Ads load ONLY after the visitor allows analytics/ads in the privacy panel
//     (consent.js writes localStorage 'jfound_cookie_consent'). Decline = no ads
//     are ever requested.
//
// TO GO LIVE WITH GOOGLE ADSENSE (Jay):
//   1. Create/verify an AdSense account and add tracks.jfound.net as a site;
//      wait for approval.
//   2. Set ADSENSE_CLIENT to your publisher id, e.g. 'ca-pub-XXXXXXXXXXXXXXXX'.
//   3. In AdSense create one display ad unit per slot below and paste its
//      numeric slot id into SLOT_IDS. Leave a value '' to keep that slot empty.
//   4. Update the privacy notice + consent copy to disclose advertising
//      (consent.js wording was changed to mention ads already).
// Any other network (EthicalAds, Carbon) can be dropped into `fillSlot()`.
(function () {
  'use strict';

  // ---- configuration (empty = ads disabled, placeholders only) ----
  var ADSENSE_CLIENT = 'ca-pub-4201800488909351';
  var SLOT_IDS = {
    'landing-mid': '',   // leaderboard on the landing page
    'blog-top': '',      // top of an article
    'blog-bottom': '',   // end of an article
    'blog-hub': '',      // blog index
    'studio': '',        // in-studio corner unit
  };

  var CONSENT_KEY = 'jfound_cookie_consent';
  var CONSENT_EVENT = 'jfound:consent'; // dispatched by consent.js in the writing tab

  function consented() {
    try {
      var p = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
      return !!(p && p.analytics === true);
    } catch (_) { return false; }
  }

  function onStudio() {
    return /^\/studio(\/|$)/.test(location.pathname) || location.pathname === '/studio.html';
  }

  // Inject the dismissible in-studio unit if not already present.
  function ensureStudioSlot() {
    if (!SLOT_IDS.studio) return; // no in-studio ad unit configured yet
    if (!onStudio() || document.getElementById('ad-studio')) return;
    if (localStorage.getItem('tracks.ad-studio.dismissed') === '1') return;
    var box = document.createElement('div');
    box.id = 'ad-studio';
    box.innerHTML =
      '<div class="ad-studio-bar"><span>ADVERTISEMENT</span>' +
      '<button type="button" class="ad-studio-x" aria-label="Hide ad">×</button></div>' +
      '<div class="ad-slot" data-ad-slot="studio"></div>';
    box.querySelector('.ad-studio-x').addEventListener('click', function () {
      try { localStorage.setItem('tracks.ad-studio.dismissed', '1'); } catch (_) {}
      box.remove();
    });
    document.body.appendChild(box);
  }

  var adsenseLoaded = false;
  function loadAdsense() {
    if (adsenseLoaded || !ADSENSE_CLIENT) return;
    // Nothing may request adsbygoogle.js before this point: no page hardcodes the
    // tag, so this consent-gated injection is the ONLY path to it. Guard anyway —
    // a second copy on the page throws in adsbygoogle.
    if (document.querySelector('script[src*="adsbygoogle.js"]')) { adsenseLoaded = true; return; }
    adsenseLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(ADSENSE_CLIENT);
    s.crossOrigin = 'anonymous';
    document.head.appendChild(s);
  }

  function fillSlot(el) {
    if (el.dataset.adFilled === '1') return;
    var name = el.getAttribute('data-ad-slot') || '';
    var slotId = SLOT_IDS[name];
    if (!ADSENSE_CLIENT || !slotId) return; // not configured → stay a placeholder
    el.dataset.adFilled = '1';
    el.classList.add('is-filled');
    el.innerHTML = '';
    var ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', ADSENSE_CLIENT);
    ins.setAttribute('data-ad-slot', slotId);
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    el.appendChild(ins);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (_) {}
  }

  function run() {
    ensureStudioSlot();
    if (!consented()) return; // no consent → no network, placeholders stay
    loadAdsense();
    var slots = document.querySelectorAll('.ad-slot');
    for (var i = 0; i < slots.length; i++) fillSlot(slots[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
  // Re-run if consent is granted after first paint.
  //   • same tab: 'storage' does NOT fire in the document that called setItem, so
  //     consent.js dispatches this custom event right after it writes the key —
  //     without it, clicking ALLOW would show no ads until the next navigation.
  //   • other tabs: 'storage' fires there, so they pick the choice up too.
  window.addEventListener(CONSENT_EVENT, run);
  window.addEventListener('storage', function (e) { if (e.key === CONSENT_KEY) run(); });
})();
