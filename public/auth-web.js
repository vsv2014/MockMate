// Shared web-auth helpers for the static pages (landing.html, dashboard.html, reset.html).
// Plain <script> (no modules) → exposes window.MMAuth.
(function (global) {
  function resolveApiBase() {
    var explicit = global.MOCKMATE_API_BASE;
    if (!explicit && global.document) {
      var meta = document.querySelector('meta[name="mockmate-api-base"]');
      explicit = meta && meta.content;
    }
    if (explicit) return String(explicit).replace(/\/$/, '');

    // Local static pages use the companion auth backend on :4000. Production pages
    // default to same-origin instead of accidentally calling the visitor's localhost.
    var origin = global.location && global.location.origin || '';
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      return (global.location.protocol || 'http:') + '//' + global.location.hostname + ':4000';
    }
    return origin;
  }
  var API = resolveApiBase();

  // Static web auth is tab-scoped, not persistent-at-rest. Electron/mobile use their
  // native secure stores. sessionStorage also prevents stale bearer tokens surviving
  // browser restarts on shared machines.
  function token() { try { return sessionStorage.getItem('mm-jwt'); } catch (e) { return null; } }
  function setToken(t) { try { if (t) sessionStorage.setItem('mm-jwt', t); else sessionStorage.removeItem('mm-jwt'); } catch (e) {} }
  function clearToken() { try { sessionStorage.removeItem('mm-jwt'); } catch (e) {} }

  var onUnauthorized = null;
  function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

  async function api(path, opts) {
    opts = opts || {};
    if (!API) throw Object.assign(new Error('MockMate API is not configured'), { network: true });
    var headers = { 'Content-Type': 'application/json' };
    if (opts.auth && token()) headers.Authorization = 'Bearer ' + token();
    var res;
    try {
      res = await fetch(API + path, {
        method: opts.method || 'GET', headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        credentials: 'include', referrerPolicy: 'no-referrer'
      });
    } catch (e) { throw Object.assign(new Error('network'), { network: true }); }
    var data = null; try { data = await res.json(); } catch (e) {}
    if (res.status === 401 && opts.auth) {
      clearToken(); if (onUnauthorized) onUnauthorized();
      throw Object.assign(new Error('Your session expired. Please sign in again.'), { status: 401 });
    }
    if (!res.ok) throw Object.assign(new Error((data && data.error) || 'Request failed'), { status: res.status });
    return data;
  }

  function initials(name, email) {
    var s = (name || email || '?').trim(); var p = s.split(/[\s@.]+/).filter(Boolean);
    return ((p[0] && p[0][0] || '') + (p[1] && p[1][0] || '')).toUpperCase() || '?';
  }
  function planLabel(plan) { return plan === 'max' ? 'Max ✦' : plan === 'pro' ? 'Pro ✦' : 'Free'; }
  function greeting() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

  global.MMAuth = {
    API: API, token: token, setToken: setToken, clearToken: clearToken,
    setUnauthorizedHandler: setUnauthorizedHandler, api: api,
    initials: initials, planLabel: planLabel, greeting: greeting,
  };
})(window);

// Keep public/landing.html as the canonical, established landing surface. Landing-only
// enhancements are loaded in order so the Arena handoff can extend the old page without
// replacing auth/theme/download contracts or the native media controls.
(function () {
  try {
    if (!/\/landing(?:\.html)?$/i.test(window.location.pathname)) return;
    if (document.querySelector('script[data-mm-landing-enhance]')) return;

    function add(src, attr, onload) {
      if (document.querySelector('script[' + attr + ']')) { if (onload) onload(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.setAttribute(attr, '1');
      if (onload) s.onload = onload;
      document.head.appendChild(s);
    }

    add('/landing-enhance.js', 'data-mm-landing-enhance', function () {
      add('/landing-arena.js', 'data-mm-landing-arena', function () {
        add('/landing-guardrails.js', 'data-mm-landing-guardrails');
      });
    });
  } catch (e) {}
})();
