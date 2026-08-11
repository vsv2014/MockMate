// The protected PiP (picture-in-picture) window's content, rendered into the separate PiP
// document. Self-contained — its own md/esc/render + BroadcastChannel listener.
// IMPORTANT: the markup is set via innerHTML, but the logic MUST be injected as a real
// <script> ELEMENT — a <script> inserted via innerHTML never executes (that left the PiP
// permanently blank: no questions/answers ever rendered). Use mountPip(pipDocument).

const PIP_HTML = `
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#08080C;color:#E8E8EC;font-family:'Kanit',system-ui,-apple-system,sans-serif;padding:12px;font-size:13px}
.badge{font-size:9px;padding:1px 7px;border-radius:10px;font-weight:700;display:inline-block;margin-right:3px}
.q{background:rgba(255,255,255,0.05);border-radius:0 8px 8px 8px;padding:7px 10px;margin-bottom:6px;font-size:12px;color:#E8E8EC;line-height:1.5}
.a{padding:10px 12px;border-radius:8px;line-height:1.55;font-size:13px;margin-left:10px}
.a-resume{background:rgba(5,46,22,0.6);border:1px solid rgba(34,197,94,0.2)}
.a-general{background:rgba(20,184,166,0.1);border:1px solid rgba(20,184,166,0.2)}
.watch{font-size:10px;color:#f59e0b;margin-top:6px;margin-left:10px}
.loading{background:rgba(255,255,255,0.04);border-radius:7px;padding:8px 10px;border:1px solid rgba(255,255,255,0.05);margin-left:10px}
.progress{height:2px;background:rgba(255,255,255,0.04);border-radius:2px;overflow:hidden;margin-top:6px}
.bar{height:100%;width:40%;background:linear-gradient(90deg,#14B8A6,#3b82f6);animation:slide 1.2s ease-in-out infinite}
.empty{text-align:center;padding:30px 0;color:#71717A;font-size:11px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}
.dot-green{background:#22c55e;box-shadow:0 0 6px #22c55e}
.dot-red{background:#ef4444}
.prot{font-size:9px;color:#71717A;text-align:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);margin-bottom:8px}
@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.cursor{display:inline-block;width:2px;height:.9em;background:#14B8A6;margin-left:2px;vertical-align:text-bottom;animation:blink .7s step-end infinite}
</style>
<div class="prot">🛡️ Protected — excluded from common screen-share APIs (verify preview)</div>
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
    if(t.startsWith('- ')||t.startsWith('• '))return '<div style="display:flex;gap:6px;margin-bottom:3px"><span style="color:#14B8A6;font-size:10px;margin-top:2px">▸</span><span>'+inlineMd(t.slice(2))+'</span></div>'
    if(/^\\*\\*[^*]+:\\*\\*/.test(t))return '<div style="font-weight:700;color:#2dd4bf;font-size:11px;letter-spacing:.04em;margin-top:8px;margin-bottom:3px">'+inlineMd(t)+'</div>'
    return '<div style="margin-bottom:4px">'+inlineMd(t)+'</div>'
  }).join('')
}

function inlineMd(text){
  return text.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong style="color:#E8E8EC;font-weight:700">$1</strong>')
}

// Mirror shared/hintLayers.js — opener → bullets → full (PiP cannot import modules).
function glanceLayers(prose, meta){
  const full=String(prose||'').trim()
  const sentences=full.split(/(?<=[.!?])\\s+/).map(s=>s.trim()).filter(Boolean)
  const opener=(meta&&meta.opener&&String(meta.opener).trim())||sentences[0]||full.slice(0,140)
  let keyPoints=Array.isArray(meta&&meta.keyPoints)?meta.keyPoints.map(String).filter(Boolean).slice(0,4):[]
  if(!keyPoints.length&&sentences.length>1){
    keyPoints=sentences.slice(1,4).map(s=>s.replace(/^[-•*]\\s*/,'').slice(0,110))
  }
  return {opener,keyPoints,fullAnswer:full}
}

function renderAnswer(s, streamingThis){
  const h=s.hint||{}
  const layers=glanceLayers(s.answer||'', h)
  const pts=layers.keyPoints||[]
  let html=''
  html+='<div style="margin-left:10px">'
  html+='<div style="margin-bottom:5px">'
  if(h.confidence==='resume')html+='<span class="badge" style="background:#14532d;color:#4ade80">🟢 RESUME</span>'
  else html+='<span class="badge" style="background:#431407;color:#fb923c">🟡 GENERAL</span>'
  if(h.questionType)html+='<span class="badge" style="background:rgba(20,184,166,.3);color:#5eead4">'+esc(TYPE_LABEL[h.questionType]||h.questionType)+'</span>'
  if(h.pattern)html+='<span class="badge" style="background:rgba(19,78,74,.5);color:#99f6e4">⚡ '+esc(h.pattern)+'</span>'
  if(h.incomplete)html+='<span class="badge" style="background:rgba(239,68,68,.2);color:#fca5a5">INCOMPLETE</span>'
  html+='</div>'
  if(h.resumeStory)html+='<div style="border-left:2px solid #4ade80;padding-left:7px;font-size:10px;color:#86efac;margin-bottom:6px;font-style:italic">'+esc(h.resumeStory)+'</div>'
  html+='<div class="a '+(h.confidence==='resume'?'a-resume':'a-general')+'">'
  if(streamingThis){
    // Opener-first while streaming — never dump the growing markdown wall.
    html+='<div style="font-weight:600;margin-bottom:'+(pts.length?'8px':'0')+';line-height:1.45">'+esc(layers.opener||'…')+'<span class="cursor"></span></div>'
    if(pts.length){
      html+='<div style="margin-bottom:6px">'
      pts.forEach(pt=>{html+='<div style="display:flex;gap:6px;margin-bottom:3px;font-size:12px"><span style="color:#14B8A6">▸</span><span>'+esc(pt)+'</span></div>'})
      html+='</div>'
    }
  } else {
    html+='<div style="font-weight:600;margin-bottom:'+(pts.length?'8px':'0')+';line-height:1.45">'+esc(layers.opener||'…')+'</div>'
    if(pts.length){
      html+='<div style="margin-bottom:6px">'
      pts.forEach(pt=>{html+='<div style="display:flex;gap:6px;margin-bottom:3px;font-size:12px"><span style="color:#14B8A6">▸</span><span>'+esc(pt)+'</span></div>'})
      html+='</div>'
    }
    const full=layers.fullAnswer||s.answer||''
    if(full.length>(layers.opener||'').length+40){
      html+='<details style="margin-top:4px"><summary style="color:#5eead4;font-size:11px;cursor:pointer;font-weight:600">Expand full answer</summary><div style="margin-top:6px;line-height:1.7">'+md(full)+'</div></details>'
    }
  }
  html+='</div>'
  if(h.watchOut)html+='<div class="watch">⚠ '+esc(h.watchOut)+'</div>'
  html+='</div>'
  return html
}

function render(state){
  const root=document.getElementById('root')
  if(!root)return
  let html=''
  const questions=(state.transcript||[]).filter(s=>s.isQuestion)
  const lastQ=state.lastQ||''

  if(questions.length===0&&!state.hintLoading){
    html='<div class="empty"><span class="dot '+(state.active?'dot-green':'dot-red')+'"></span>'+(state.active?'Listening…':'Not capturing')+'</div>'
  }

  questions.forEach(s=>{
    const streamingThis=!!state.streaming&&s.text===lastQ
    html+='<div style="margin-bottom:14px">'
    html+='<div class="q">❓ '+esc(s.text)+'</div>'
    if(s.answer!==undefined&&s.hint){
      html+=renderAnswer(s, streamingThis)
    }
    html+='</div>'
  })

  if(state.hintLoading){
    html+='<div style="margin-bottom:14px">'
    html+='<div class="q" style="color:#8A8A8E;font-style:italic">❓ '+esc(lastQ||'')+'</div>'
    html+='<div class="loading"><div style="font-size:10px;color:#5eead4;margin-bottom:4px">'+esc(state.buyTimePhrase||'Thinking…')+'</div><div class="progress"><div class="bar"></div></div></div>'
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
