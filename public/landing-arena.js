(function () {
  if (!/\/landing(?:\.html)?$/i.test(location.pathname)) return;

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  ready(function () {
    var hero = document.querySelector('.hero');
    if (!hero || document.getElementById('mm-arena-hero')) return;

    var heroBrand = hero.querySelector('.hero-brand');
    if (heroBrand) {
      var mark = heroBrand.querySelector('.mark');
      if (mark) mark.outerHTML = '<img src="/icon.png" width="52" height="52" alt="" class="mm-app-icon" />';
    }

    var mockup = hero.querySelector('.mockup-wrap');
    var platforms = hero.querySelector('.platforms');
    var copyNodes = [heroBrand, hero.querySelector('h1'), hero.querySelector('.hero-sub'), hero.querySelector('.hero-ctas'), hero.querySelector('.hero-trust')].filter(Boolean);

    if (mockup && copyNodes.length) {
      var grid = document.createElement('div');
      grid.id = 'mm-arena-hero';
      grid.className = 'mm-arena-hero';
      var copy = document.createElement('div');
      copy.className = 'mm-arena-copy';
      copyNodes.forEach(function (node) { copy.appendChild(node); });

      var media = document.createElement('div');
      media.className = 'mm-campaign-stage';
      media.innerHTML = [
        '<div class="mm-campaign-card mm-card-a">',
          '<img src="/media/card-solo-practice.png" width="1080" height="1080" alt="Illustrative MockMate Solo Practice campaign card" />',
        '</div>',
        '<div class="mm-campaign-card mm-card-b">',
          '<img src="/media/card-live-mode.png" width="920" height="920" alt="Illustrative MockMate Live mode campaign card" />',
        '</div>',
        '<span class="mm-illustrative-label">Illustrative campaign visuals</span>'
      ].join('');

      grid.appendChild(copy);
      grid.appendChild(media);
      hero.insertBefore(grid, mockup);
      mockup.classList.add('mm-product-proof');
      if (platforms) platforms.classList.add('mm-platforms-full');
    }

    if (!document.getElementById('mm-practice-band')) {
      var band = document.createElement('section');
      band.id = 'mm-practice-band';
      band.className = 'mm-practice-band';
      band.innerHTML = '<span>Practice.</span><span>Reflect.</span><span>Improve.</span>';
      hero.insertAdjacentElement('afterend', band);
    }

    var how = document.getElementById('how');
    if (how && !document.getElementById('mm-explainer')) {
      var explainer = document.createElement('section');
      explainer.id = 'mm-explainer';
      explainer.className = 'section mm-explainer';
      explainer.innerHTML = [
        '<span class="section-tag reveal in">See MockMate in motion</span>',
        '<div class="mm-explainer-grid">',
          '<div>',
            '<h2 class="section-h reveal in">Practice the first answer — and the follow-up.</h2>',
            '<p class="section-p reveal in">A short narrated walkthrough of the interview-practice flow. Controls are the browser’s native controls, including volume, captions, and fullscreen.</p>',
            '<p class="mm-explainer-links"><a href="/media/mockmate-video-transcript.txt" target="_blank" rel="noopener">Read transcript</a> · <a href="/media/mockmate-voiceover.mp3" target="_blank" rel="noopener">Audio only</a></p>',
          '</div>',
          '<div class="mm-video-frame reveal in">',
            '<video controls playsinline preload="metadata" poster="/media/card-solo-practice.png">',
              '<source src="/media/mockmate-promotional-video.mp4" type="video/mp4" />',
              '<track kind="captions" srclang="en" label="English" src="/media/mockmate-video-captions.srt" default />',
              'Your browser does not support HTML video.',
            '</video>',
          '</div>',
        '</div>'
      ].join('');
      how.parentNode.insertBefore(explainer, how);
    }

    var og = document.querySelector('meta[property="og:image"]');
    if (!og) {
      og = document.createElement('meta');
      og.setAttribute('property', 'og:image');
      document.head.appendChild(og);
    }
    og.content = location.origin + '/media/og-social.png';

    if (!document.querySelector('link[data-mm-hero-preload]')) {
      var preload = document.createElement('link');
      preload.rel = 'preload';
      preload.as = 'image';
      preload.href = '/media/card-solo-practice.png';
      preload.dataset.mmHeroPreload = '1';
      document.head.appendChild(preload);
    }

    document.documentElement.classList.add('mm-arena-ready');
  });

  var css = document.createElement('style');
  css.textContent = [
    '.mm-arena-hero{width:min(1120px,100%);display:grid;grid-template-columns:1.02fr .98fr;gap:54px;align-items:center;text-align:left;margin:0 auto 42px}',
    '.mm-arena-copy{display:flex;flex-direction:column;align-items:flex-start}.mm-arena-copy .hero-brand{justify-content:flex-start}.mm-arena-copy .hero-sub{margin-left:0;margin-right:0}.mm-arena-copy .hero-ctas,.mm-arena-copy .hero-trust{justify-content:flex-start}',
    '.mm-app-icon{border-radius:14px;box-shadow:0 10px 28px rgba(13,148,136,.28)}',
    '.mm-campaign-stage{position:relative;min-height:500px;isolation:isolate}.mm-campaign-card{position:absolute;inset:0;display:grid;place-items:center;opacity:0;animation:mmCrossfade 12s ease-in-out infinite}.mm-campaign-card img{width:min(100%,480px);height:auto;border-radius:24px;box-shadow:0 34px 80px rgba(28,26,22,.28);transform:scale(1.02);animation:mmKenBurns 12s ease-in-out infinite}.mm-card-a{opacity:1}.mm-card-b{animation-delay:6s}.mm-card-b img{animation-delay:6s}.mm-illustrative-label{position:absolute;right:8px;bottom:6px;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}',
    '@keyframes mmCrossfade{0%,42%{opacity:1}50%,92%{opacity:0}100%{opacity:1}}@keyframes mmKenBurns{0%{transform:scale(1.02) translate3d(0,0,0)}50%{transform:scale(1.075) translate3d(-1.2%,1%,0)}100%{transform:scale(1.02) translate3d(0,0,0)}}',
    '.mm-product-proof{margin-top:24px}.mm-platforms-full{width:100%}',
    '.mm-practice-band{display:flex;justify-content:center;gap:clamp(18px,6vw,70px);padding:24px 20px;border-top:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--surface);font-family:"Inter Tight",sans-serif;font-weight:700;font-size:clamp(20px,3vw,34px);letter-spacing:-.03em}.mm-practice-band span:nth-child(2){color:var(--accent)}',
    '.mm-explainer-grid{display:grid;grid-template-columns:1fr .68fr;gap:54px;align-items:center;margin-top:28px}.mm-video-frame{max-width:360px;justify-self:center;width:100%;border-radius:24px;overflow:hidden;box-shadow:var(--shadow-md);background:#0f0e13;border:1px solid var(--border-2)}.mm-video-frame video{display:block;width:100%;aspect-ratio:9/16;object-fit:cover;background:#0f0e13}.mm-explainer-links{margin-top:18px;font-size:13px;color:var(--muted)}.mm-explainer-links a{color:var(--accent-deep);font-weight:600}',
    '@media(max-width:900px){.mm-arena-hero,.mm-explainer-grid{grid-template-columns:1fr}.mm-arena-hero{text-align:center}.mm-arena-copy{align-items:center}.mm-arena-copy .hero-sub{margin-left:auto;margin-right:auto}.mm-arena-copy .hero-ctas,.mm-arena-copy .hero-trust{justify-content:center}.mm-campaign-stage{min-height:430px}.mm-video-frame{max-width:320px}}',
    '@media(prefers-reduced-motion:reduce){.mm-campaign-card,.mm-campaign-card img{animation:none!important}.mm-card-a{opacity:1!important}.mm-card-b{display:none!important}}'
  ].join('');
  document.head.appendChild(css);
})();