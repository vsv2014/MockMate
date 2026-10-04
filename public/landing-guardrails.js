(function () {
  if (!/\/landing(?:\.html)?$/i.test(location.pathname)) return;

  function run() {
    var ua = navigator.userAgent || '';
    var isMac = ua.includes('Macintosh') || ua.includes('Mac OS');
    var isLinux = ua.includes('Linux') && !ua.includes('Android');
    var label = 'Download for Windows';
    var badge = 'Windows 10/11 · pick the .exe on the releases page';
    var stealth = '✓ Content protection available — always verify Zoom/Meet/Teams share preview';
    if (isMac) {
      label = 'Download for macOS';
      badge = 'macOS runtime/packaging support exists; check Releases for an available artifact';
    } else if (isLinux) {
      label = 'Download for Linux';
      badge = 'Linux runtime/packaging support exists; overlay is visible in screen share';
      stealth = '⚠ Linux: overlay shows in screen share — content protection is not supported';
    }
    ['nav-download', 'hero-download', 'cta-download'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.href = 'https://github.com/vsv2014/MockMate/releases/latest';
      if (id === 'nav-download') el.textContent = label + ' →';
      else el.textContent = '↓ ' + label;
    });
    var mobile = document.querySelector('.mm-mobile-cta');
    if (mobile) mobile.textContent = label;
    var chip = document.getElementById('hero-stealth-chip');
    if (chip) chip.textContent = stealth;
    var existingBadge = document.querySelector('.hero-ctas + div[style*="width:100%"]');
    if (existingBadge) existingBadge.textContent = badge;

    if (!document.querySelector('.skip-link')) {
      var skip = document.createElement('a');
      skip.className = 'skip-link';
      skip.href = '#how';
      skip.textContent = 'Skip to main content';
      document.body.insertBefore(skip, document.body.firstChild);
      var style = document.createElement('style');
      style.textContent = '.skip-link{position:fixed;top:10px;left:12px;z-index:1000;transform:translateY(-140%);background:var(--surface);color:var(--ink);border:1px solid var(--border-2);border-radius:10px;padding:10px 14px;text-decoration:none}.skip-link:focus{transform:translateY(0)}';
      document.head.appendChild(style);
    }
    [['li-email','Email'],['li-pass','Password'],['su-name','Full name'],['su-email','Email'],['su-pass','Password']].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (el && !el.getAttribute('aria-label')) el.setAttribute('aria-label', pair[1]);
    });

    document.querySelectorAll('video').forEach(function (video) { video.controls = true; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();