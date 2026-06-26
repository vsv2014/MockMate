// Shared web-auth helpers for the static pages (landing.html, dashboard.html, reset.html).
// One source of truth for the API base, JWT storage, the fetch wrapper + 401 handling, and the
// small display helpers — so the three pages don't each hand-maintain their own copy.
//
// Plain <script> (no modules) → exposes window.MMAuth. JWT lives in localStorage under 'mm-jwt'
// (web context; the desktop app uses Electron safeStorage via src/auth/api.js — same token scheme,
// different at-rest storage by necessity).
(function (global) {
  // TODO: point at the hosted backend URL for production (currently the local fork).
  var API = 'http://localhost:4000';

  function token() { try { return localStorage.getItem('mm-jwt'); } catch (e) { return null; } }
  function setToken(t) { try { localStorage.setItem('mm-jwt', t); } catch (e) {} }
  function clearToken() { try { localStorage.removeItem('mm-jwt'); } catch (e) {} }

  // Each page registers what should happen on a 401 (e.g. show signed-out nav, or redirect).
  var onUnauthorized = null;
  function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

  async function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (opts.auth && token()) headers['Authorization'] = 'Bearer ' + token();
    var res;
    try {
      res = await fetch(API + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    } catch (e) { throw Object.assign(new Error('network'), { network: true }); }
    var data = null; try { data = await res.json(); } catch (e) {}
    if (res.status === 401 && opts.auth) { clearToken(); if (onUnauthorized) onUnauthorized(); throw Object.assign(new Error('401'), { status: 401 }); }
    if (!res.ok) throw Object.assign(new Error((data && data.error) || 'Request failed'), { status: res.status });
    return data;
  }

  // Display helpers
  function initials(name, email) {
    var s = (name || email || '?').trim();
    var p = s.split(/[\s@.]+/).filter(Boolean);
    return ((p[0] && p[0][0] || '') + (p[1] && p[1][0] || '')).toUpperCase() || '?';
  }
  function planLabel(plan) { return plan === 'pro' ? 'Pro ✦' : 'Free'; }
  function greeting() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

  global.MMAuth = {
    API: API, token: token, setToken: setToken, clearToken: clearToken,
    setUnauthorizedHandler: setUnauthorizedHandler, api: api,
    initials: initials, planLabel: planLabel, greeting: greeting,
  };
})(window);
