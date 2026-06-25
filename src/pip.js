// The protected PiP (picture-in-picture) window's content, rendered into the separate PiP
// document. Self-contained — its own md/esc/render + BroadcastChannel listener.
// IMPORTANT: the markup is set via innerHTML, but the logic MUST be injected as a real
// <script> ELEMENT — a <script> inserted via innerHTML never executes (that left the PiP
// permanently blank: no questions/answers ever rendered). Use mountPip(pipDocument).

const PIP_HTML = `
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#08090e;color:#e2e8f0;font-family:system-ui,sans-serif;padding:12px;font-size:13px}
.badge{font-size:9px;padding:1px 7px;border-radius:10px;font-weight:700;display:inline-block;margin-right:3px}
.q{background:rgba(255,255,255,0.05);border-radius:0 8px 8px 8px;padding:7px 10px;margin-bottom:6px;font-size:12px;color:#cbd5e1;line-height:1.5}
.a{padding:10px 12px;border-radius:8px;line-height:1.75;font-size:13px;margin-left:10px}
.a-resume{background:rgba(5,46,22,0.6);border:1px solid rgba(34,197,94,0.2)}
.a-general{background:rgba(20,184,166,0.1);border:1px solid rgba(20,184,166,0.2)}
.watch{font-size:10px;color:#f59e0b;margin-top:6px;margin-left:10px}
.loading{background:rgba(255,255,255,0.04);border-radius:7px;padding:8px 10px;border:1px solid rgba(255,255,255,0.05);margin-left:10px}
.progress{height:2px;background:rgba(255,255,255,0.04);border-radius:2px;overflow:hidden;margin-top:6px}
.bar{height:100%;width:40%;background:linear-gradient(90deg,#0d9488,#3b82f6);animation:slide 1.2s ease-in-out infinite}
.empty{text-align:center;padding:30px 0;color:#334155;font-size:11px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}
.dot-green{background:#22c55e;box-shadow:0 0 6px #22c55e}
.dot-red{background:#ef4444}
.prot{font-size:9px;color:#334155;text-align:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);margin-bottom:8px}
@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.cursor{display:inline-block;width:2px;height:.9em;background:#0d9488;margin-left:2px;vertical-align:text-bottom;animation:blink .7s step-end infinite}
</style>
<div class="prot">🛡️ Protected — excluded from all screen capture</div>
<div id="root"></div>`

const PIP_SCRIPT = `
const bc = new BroadcastChannel('mockmate-live')
const TYPE_LABEL = {behavioral:'🧩 Behavioral',technical:'⚙️ Technical',system_design:'🏗️ System Design',resume:'📄 Resume',culture:'🤝 Culture',dsa:'⚡ DSA',coding:'💻 Coding',other:'💬 General'}

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

function md(text){
  if(!text)return ''
  return text.split('\\n').map(line=>{
    const t=line.trim()
    if(!t)return '<div style="height:6px"></div>'
    if(t.startsWith('- ')||t.startsWith('• '))return '<div style="display:flex;gap:6px;margin-bottom:3px"><span style="color:#0d9488;font-size:10px;margin-top:2px">▸</span><span>'+inlineMd(t.slice(2))+'</span></div>'
    if(/^\\*\\*[^*]+:\\*\\*/.test(t))return '<div style="font-weight:700;color:#2dd4bf;font-size:11px;letter-spacing:.04em;margin-top:8px;margin-bottom:3px">'+inlineMd(t)+'</div>'
    return '<div style="margin-bottom:4px">'+inlineMd(t)+'</div>'
  }).join('')
}

function inlineMd(text){
  return text.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong style="color:#e2e8f0;font-weight:700">$1</strong>')
}

function render(state){
  const root=document.getElementById('root')
  if(!root)return
  let html=''
  const questions=(state.transcript||[]).filter(s=>s.isQuestion)

  if(questions.length===0&&!state.hintLoading){
    html='<div class="empty"><span class="dot '+(state.active?'dot-green':'dot-red')+'"></span>'+(state.active?'Listening…':'Not capturing')+'</div>'
  }

  questions.forEach(s=>{
    html+='<div style="margin-bottom:14px">'
    html+='<div class="q">❓ '+esc(s.text)+'</div>'
    if(s.answer!==undefined&&s.hint){
      const h=s.hint
      html+='<div style="margin-left:10px">'
      html+='<div style="margin-bottom:5px">'
      if(h.confidence==='resume')html+='<span class="badge" style="background:#14532d;color:#4ade80">🟢 RESUME</span>'
      else html+='<span class="badge" style="background:#431407;color:#fb923c">🟡 GENERAL</span>'
      if(h.questionType)html+='<span class="badge" style="background:rgba(20,184,166,.3);color:#5eead4">'+esc(TYPE_LABEL[h.questionType]||h.questionType)+'</span>'
      if(h.pattern)html+='<span class="badge" style="background:rgba(19,78,74,.5);color:#99f6e4">⚡ '+esc(h.pattern)+'</span>'
      html+='</div>'
      if(h.resumeStory)html+='<div style="border-left:2px solid #4ade80;padding-left:7px;font-size:10px;color:#86efac;margin-bottom:6px;font-style:italic">'+esc(h.resumeStory)+'</div>'
      html+='<div class="a '+(h.confidence==='resume'?'a-resume':'a-general')+'">'+md(s.answer||'…')+'</div>'
      if(h.watchOut)html+='<div class="watch">⚠ '+esc(h.watchOut)+'</div>'
      html+='</div>'
    }
    html+='</div>'
  })

  if(state.hintLoading){
    html+='<div style="margin-bottom:14px">'
    html+='<div class="q" style="color:#94a3b8;font-style:italic">❓ '+esc(state.lastQ||'')+'</div>'
    html+='<div class="loading"><div style="font-size:10px;color:#475569;margin-bottom:4px">Say: <em style="color:#5eead4">"'+esc(state.buyTimePhrase||'')+'"</em></div><div class="progress"><div class="bar"></div></div></div>'
    html+='</div>'
  }

  root.innerHTML=html
}

bc.onmessage=e=>{
  if(e.data.type==='update'||e.data.type==='init')render(e.data)
}
window.addEventListener('pagehide',()=>bc.close())`

// Mount the PiP UI into a freshly-opened PiP document. Injects the script as a real element
// so its BroadcastChannel listener actually runs (innerHTML <script> would never execute).
export function mountPip(doc) {
  doc.body.innerHTML = PIP_HTML
  const s = doc.createElement('script')
  s.textContent = PIP_SCRIPT
  doc.body.appendChild(s)
}
