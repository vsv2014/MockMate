(function () {
  if (!/\/landing(?:\.html)?$/i.test(location.pathname)) return;

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  ready(function () {
    document.title = 'MockMate — AI interview practice & live companion';
    var desc = document.querySelector('meta[name="description"]');
    if (desc) desc.content = 'Prepare with realistic mock interviews and use context-aware assistance when interviews get real. MockMate grounds help in your resume, job description, documents, playbook, and current conversation.';
    if (!document.querySelector('link[rel="canonical"]')) {
      var canonical = document.createElement('link');
      canonical.rel = 'canonical';
      canonical.href = 'https://mock-mate-theta-nine.vercel.app/landing.html';
      document.head.appendChild(canonical);
    }

    function ensureMeta(property, content, isName) {
      var sel = isName ? 'meta[name="' + property + '"]' : 'meta[property="' + property + '"]';
      var el = document.querySelector(sel);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(isName ? 'name' : 'property', property);
        document.head.appendChild(el);
      }
      el.content = content;
    }
    ensureMeta('og:type', 'website');
    ensureMeta('og:title', 'MockMate — prepare better, think faster when interviews get real');
    ensureMeta('og:description', 'AI interview practice and live assistance grounded in your resume, JD, documents, playbook, and conversation.');
    ensureMeta('og:url', 'https://mock-mate-theta-nine.vercel.app/landing.html');
    ensureMeta('twitter:card', 'summary', true);

    var heroH1 = document.querySelector('.hero h1');
    if (heroH1) heroH1.innerHTML = 'Prepare better.<br><span class="highlight">Think faster when the interview gets real.</span>';
    var heroSub = document.querySelector('.hero-sub');
    if (heroSub) heroSub.textContent = 'Practice realistic interviews before they happen, then stay grounded in live interviews with help based on your resume, job description, selected documents, playbook, and conversation.';
    var heroSecondary = document.querySelector('.hero-ctas .btn-secondary');
    if (heroSecondary) {
      heroSecondary.href = '#core-modes';
      heroSecondary.textContent = 'See Solo + Live';
    }

    var trust = document.getElementById('hero-trust');
    if (trust) {
      trust.innerHTML =
        '<span>✓ Windows public release</span>' +
        '<span>✓ Managed AI where configured · BYOK available</span>' +
        '<span id="hero-stealth-chip">✓ Win/macOS: verify share preview before a real interview</span>';
    }

    var mockup = document.querySelector('.mockup-wrap');
    if (mockup && !mockup.querySelector('.mm-illustrative')) {
      var note = document.createElement('div');
      note.className = 'mm-illustrative';
      note.textContent = 'Illustrative product view';
      mockup.appendChild(note);
    }

    var how = document.getElementById('how');
    if (how && !document.getElementById('core-modes')) {
      var narrative = document.createElement('div');
      narrative.innerHTML = [
        '<section class="section mm-story" id="core-modes">',
          '<span class="section-tag reveal in">Two ways to use MockMate</span>',
          '<h2 class="section-h reveal in">Practice before it matters.<br>Stay grounded when it does.</h2>',
          '<p class="section-p reveal in">MockMate is one interview companion with two clear modes: rehearse in Solo, or use Live when the real conversation starts.</p>',
          '<div class="mm-mode-grid">',
            '<article class="mm-mode-card reveal in">',
              '<span class="mm-kicker">SOLO PRACTICE</span>',
              '<h3>Build the answer before interview day.</h3>',
              '<p>Role-calibrated questions, realistic follow-ups, and feedback based on what you actually said.</p>',
              '<ul><li>Resume + JD aware practice</li><li>Behavioral, coding and system-design rounds</li><li>Repeat weak areas with targeted follow-ups</li></ul>',
            '</article>',
            '<article class="mm-mode-card reveal in">',
              '<span class="mm-kicker">LIVE COMPANION</span>',
              '<h3>Keep your context close when the interview gets real.</h3>',
              '<p>Compact assistance grounded in your own experience and the current conversation—not a generic chat response.</p>',
              '<ul><li>System-audio question capture</li><li>Glance-first opener + key points</li><li>Coding and screenshot-question support</li></ul>',
            '</article>',
          '</div>',
        '</section>',
        '<section class="section mm-grounding" id="grounding" style="padding-top:0">',
          '<span class="section-tag reveal in">Grounded answers</span>',
          '<h2 class="section-h reveal in">Answers that know your story.</h2>',
          '<p class="section-p reveal in">Generic AI knows the question. MockMate can also know the experience, role, documents and conversation behind your answer.</p>',
          '<div class="mm-context-grid reveal in">',
            '<span>✓ Resume</span><span>✓ Job description</span><span>✓ Selected docs</span><span>✓ Interview playbook</span><span>✓ Current conversation</span>',
          '</div>',
        '</section>',
        '<section class="section mm-code-story" id="coding" style="padding-top:0">',
          '<div class="mm-code-grid">',
            '<div>',
              '<span class="section-tag reveal in">Coding + screen questions</span>',
              '<h2 class="section-h reveal in">Stay in the interview flow.</h2>',
              '<p class="section-p reveal in">Use F7 to analyze a coding prompt or technical screen and switch between the full answer, code, and steps without bouncing between tools.</p>',
            '</div>',
            '<div class="mm-code-sample reveal in">',
              '<span class="mm-code-label">F7 · SCREEN QUESTION</span>',
              '<strong>Implement an LRU cache</strong>',
              '<div><b>Approach</b><span>Hash map + doubly linked list</span></div>',
              '<div><b>Complexity</b><span>O(1) get / put</span></div>',
              '<div><b>Watch out</b><span>Update recency on both reads and writes</span></div>',
            '</div>',
          '</div>',
        '</section>'
      ].join('');
      how.parentNode.insertBefore(narrative, how);
    }

    var replacements = [
      ['Grab the installer for Windows, macOS, or Linux. No terminal, no Node.js — just run it.',
       'Download the current public Windows installer. macOS and Linux runtime/packaging code remain in the project, but v1.5.2 public automation is Windows-first.'],
      ['Open Settings and paste your OpenAI, Claude, Gemini, or Deepgram key — no config files. Managed "no-key" AI is coming soon.',
       'Choose the setup available to you: Managed AI where the hosted service is configured, or bring your own supported provider key from Settings.'],
      ['# Bring your own key (for now)', '# Bring your own key'],
      ['# Managed AI — coming soon', '# Managed AI'],
      ['Sign in and go — no keys needed', 'Sign in and use managed services where configured'],
      ['Bring your own key.', 'Choose managed AI or bring your own key.'],
      ['Paste your keys in Settings — most providers have a generous free tier, so you can run MockMate at low or zero cost. Prefer zero setup? Managed AI (no keys, just sign in) is coming soon.',
       'Use managed services where configured, or bring your own supported provider credentials. BYOK keys stay on your device, while prompts, audio, or other inputs still go to the providers you choose.'],
      ['About a second after the interviewer finishes the question. The answer streams onto your screen word-by-word, so you can start speaking almost immediately.',
       'Response time varies by provider, model, network and request type. MockMate streams results as they arrive and uses fast-path routing where appropriate.'],
      ['Yes. MockMate runs on your machine. Your resume and API keys are stored locally and never sent to us — the app talks directly to the AI provider you choose.',
       'BYOK credentials are stored on your device. Prompts, audio and other inputs may still be sent to the AI or transcription providers you configure. Managed services use the hosted MockMate backend where enabled.'],
      ['Yes — add a free Groq or Gemini key (no credit card) and go. Bring a paid OpenAI or Anthropic key when you want the strongest models. Note: a ChatGPT Plus subscription is not an API key and won\'t work.',
       'You can use BYOK with supported providers, and managed services may be available when configured for your account/environment. Provider pricing and quotas can change, so check the provider before relying on a “free” tier.'],
      ['All three. Windows and Linux update automatically; macOS is supported with a manual update for now.',
       'The current automated public v1.5.2 release artifact is Windows. macOS and Linux code remain in the project, but they are not being advertised here as current public v1.5.2 downloads.']
    ];
    document.querySelectorAll('p,h2,h3,h4,.c-comment,.c-cmd').forEach(function (el) {
      var text = el.textContent.trim();
      replacements.forEach(function (pair) {
        if (text === pair[0]) el.textContent = pair[1];
      });
    });

    var ctaP = document.querySelector('.cta-section p');
    if (ctaP) ctaP.textContent = 'Practice with your own context, then carry that context into the real interview.';

    if (!document.querySelector('.mm-mobile-cta')) {
      var sticky = document.createElement('a');
      sticky.className = 'mm-mobile-cta';
      sticky.href = 'https://github.com/vsv2014/MockMate/releases/latest';
      sticky.target = '_blank';
      sticky.rel = 'noopener noreferrer';
      sticky.textContent = 'Download for Windows';
      document.body.appendChild(sticky);
    }

    var signup = document.getElementById('su-submit');
    if (signup && window.MMAuth) {
      signup.addEventListener('click', async function (event) {
        var nameEl = document.getElementById('su-name');
        var emailEl = document.getElementById('su-email');
        var passEl = document.getElementById('su-pass');
        var err = document.getElementById('su-error');
        if (!nameEl || !emailEl || !passEl || !err) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        err.textContent = '';
        var name = nameEl.value.trim(), email = emailEl.value.trim(), password = passEl.value;
        if (!name || !email || !password) { err.textContent = 'Please fill in all fields'; return; }
        if (password.length < 8) { err.textContent = 'Password must be at least 8 characters'; return; }
        try {
          var r = await MMAuth.api('/auth/signup', { method:'POST', body:{ name:name, email:email, password:password } });
          if (r && r.verificationRequired) {
            MMAuth.clearToken();
            err.style.color = 'var(--green)';
            err.textContent = 'Check your email to verify your account, then sign in.';
            return;
          }
          if (!r || !r.token) throw new Error('Signup completed without a session token.');
          MMAuth.setToken(r.token);
          location.href = 'dashboard.html';
        } catch (e) {
          err.style.color = '';
          err.textContent = e.network ? 'Can’t reach the server. Is it running?'
            : (e.status === 409 ? 'Email already registered. Sign in instead.' : (e.message || 'Could not create account'));
        }
      }, true);
    }
  });

  var css = document.createElement('style');
  css.textContent = [
    '.mm-illustrative{position:absolute;right:10px;bottom:-28px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}',
    '.mm-mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:30px}',
    '.mm-mode-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:28px;box-shadow:var(--shadow-sm)}',
    '.mm-mode-card h3{font-size:20px;margin:8px 0 10px;color:var(--ink)}',
    '.mm-mode-card p,.mm-mode-card li{color:var(--muted);font-size:14px;line-height:1.65}',
    '.mm-mode-card ul{padding-left:18px;margin:16px 0 0}',
    '.mm-kicker{font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--accent-deep)}',
    '.mm-context-grid{display:flex;gap:10px;flex-wrap:wrap;margin-top:28px}',
    '.mm-context-grid span{background:var(--accent-soft);color:var(--accent-deep);border:1px solid rgba(13,148,136,.18);padding:9px 12px;border-radius:999px;font-size:13px;font-weight:600}',
    '.mm-code-grid{display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:center}',
    '.mm-code-sample{background:#121117;color:#ece8f3;border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:24px;box-shadow:var(--shadow-md)}',
    '.mm-code-label{display:block;font-size:10px;letter-spacing:.12em;color:#62d7c7;margin-bottom:10px}',
    '.mm-code-sample strong{font-size:17px;display:block;margin-bottom:14px}',
    '.mm-code-sample div{display:flex;justify-content:space-between;gap:16px;border-top:1px solid rgba(255,255,255,.08);padding:10px 0;font-size:12px}',
    '.mm-code-sample b{color:#8fe8dc}.mm-code-sample span{color:#b7b2c1;text-align:right}',
    '.mm-mobile-cta{display:none;position:fixed;z-index:140;left:14px;right:14px;bottom:14px;background:linear-gradient(150deg,var(--accent),var(--accent-deep));color:#fff;text-align:center;text-decoration:none;padding:13px 18px;border-radius:12px;font-weight:700;box-shadow:0 14px 40px rgba(13,148,136,.35)}',
    '@media(max-width:760px){.mm-mode-grid,.mm-code-grid{grid-template-columns:1fr}.mm-mobile-cta{display:block}body{padding-bottom:74px}.mm-illustrative{position:static;text-align:center;margin-top:8px}}'
  ].join('');
  document.head.appendChild(css);
})();