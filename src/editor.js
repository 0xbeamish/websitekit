import { esc, FONT_LINK, TOOL_CSS } from "./html.js";
import { normalize, toSlug, uniqueSlug, MAX_PAGES } from "./schema.js";
import { editorGroups, buildEditorForm } from "./editorform.js";
import { describeChanges, PER_SITE_DAILY } from "./ai.js";
import { addEditor, makeHandoff, googleReady } from "./auth.js";
import { messageRows, messagesPanel, messagesPost } from "./messages.js";

// /edit for one site. Every change lands in the draft; Publish copies the draft to the live site and
// records a version. draft_rev guards against two people (or a person and the assistant) overwriting each other.

export const loadSite = (env, id) => env.DB.prepare("SELECT * FROM sites WHERE id = ? AND status != 'archived'").bind(id).first();
const draftOf = (site) => JSON.parse(site.draft || site.config);

async function saveDraft(env, site, rev, config) {
  const r = await env.DB.prepare("UPDATE sites SET draft = ?, draft_rev = draft_rev + 1, updated_at = datetime('now') WHERE id = ? AND draft_rev = ?")
    .bind(JSON.stringify(config), site.id, rev).run();
  return r.meta.changes === 1;
}
const CONFLICT = { flash: "Someone else saved a change while you were editing, so yours wasn’t saved. Their version is loaded now — please make your change again.", tone: "warn" };

// ---------- page chrome ----------

const CSS = TOOL_CSS + `
html,body{height:100%}
.top{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:var(--s3);min-height:64px;padding:var(--s2) var(--s5);background:var(--surface);border-bottom:1px solid var(--line)}
.top .who{min-width:0;flex:1}.top .site{font-weight:700;font-size:var(--t-md);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.state{display:inline-flex;align-items:center;gap:6px;font-size:var(--t-sm);color:var(--muted)}
.state::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--publish)}.state.changed{color:var(--attention)}.state.changed::before{background:var(--attention)}
.state.review::before{background:var(--muted)}
.layout{display:grid;grid-template-columns:minmax(380px,460px) 1fr;height:calc(100vh - 64px)}
.panel{overflow:auto;background:var(--paper);border-right:1px solid var(--line);padding:var(--s5) var(--s5) 0}
.stage{display:flex;flex-direction:column;padding:var(--s4) var(--s5) var(--s5);min-width:0;background:#ECE8DE}
.stage-bar{display:flex;align-items:center;justify-content:space-between;gap:var(--s3);margin-bottom:var(--s3)}
.stage-bar .label{font-weight:700}
.seg{display:inline-flex;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:3px}
.seg button{border:0;background:none;min-height:36px;padding:0 var(--s3);border-radius:6px;font-weight:700;cursor:pointer;color:var(--muted)}
.seg button[aria-pressed=true]{background:var(--ink);color:#fff}
.frame-wrap{flex:1;display:flex;justify-content:center;min-height:0}
.frame{width:100%;height:100%;border:1px solid var(--line);border-radius:var(--r);background:#fff}.frame.phone{width:390px}
.explain{font-size:var(--t-sm);color:var(--muted);margin:0 0 var(--s4)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:var(--s4);margin-bottom:var(--s5)}
.card h2{font-size:var(--t-md);margin:0 0 var(--s1)}.card .sub{margin:0 0 var(--s3);color:var(--muted);font-size:var(--t-sm)}
.card .foot{display:flex;justify-content:space-between;align-items:center;gap:var(--s3);margin-top:var(--s3)}
.list-title{font-size:var(--t-sm);font-weight:700;color:var(--muted);margin:0 0 var(--s2)}
details.group{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);margin-bottom:var(--s2)}
details.group>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:var(--s3);min-height:52px;padding:0 var(--s4);font-weight:700}
details.group>summary::-webkit-details-marker{display:none}
details.group>summary::after{content:"";width:8px;height:8px;margin-left:auto;border-right:2px solid var(--ink);border-bottom:2px solid var(--ink);transform:rotate(45deg);transition:transform .15s;flex:none}
details.group[open]>summary::after{transform:rotate(-135deg)}
.chip{font-size:var(--t-sm);font-weight:400;color:var(--muted)}.chip.off{font-style:italic}
.group-body{padding:0 var(--s4) var(--s4);border-top:1px solid var(--line)}
.groups{position:relative;padding-left:22px}
.groups::before{content:"";position:absolute;left:6px;top:26px;bottom:26px;width:2px;background:var(--line)}
.groups details.group{position:relative}
.groups details.group::before{content:"";position:absolute;left:-21px;top:20px;width:12px;height:12px;border-radius:50%;background:var(--ink);box-shadow:0 0 0 3px var(--paper)}
.groups details.group.empty::before{background:var(--paper);border:2px solid var(--muted);width:8px;height:8px}
.item{padding-top:var(--s2);border-top:1px dashed var(--line);margin-top:var(--s4)}.item:first-of-type{border-top:0;margin-top:0}
.savebar{position:sticky;bottom:0;display:flex;flex-wrap:wrap;align-items:center;gap:var(--s3);padding:var(--s4) 0;margin-top:var(--s3);background:var(--paper);border-top:1px solid var(--line)}
.savebar .note{font-size:var(--t-sm);color:var(--muted);flex:1;min-width:10rem}.savebar .note.changed{color:var(--attention);font-weight:700}
.history{list-style:none;padding:0;margin:0}.history li{display:flex;justify-content:space-between;align-items:center;gap:var(--s2);padding:var(--s2) 0;border-top:1px solid var(--line);font-size:var(--t-sm)}
.signed{font-size:var(--t-sm);color:var(--muted);margin:var(--s5) 0}
.sr{position:absolute;left:-9999px}
.drawer{display:flex;flex-direction:column;min-height:0;background:var(--paper);border-left:1px solid var(--line)}.drawer[hidden]{display:none}
.drawer-head{display:flex;justify-content:space-between;align-items:center;padding:var(--s3) var(--s4);border-bottom:1px solid var(--line);background:var(--surface)}.drawer-head h2{margin:0;font-size:var(--t-md)}
.drawer-body{flex:1;overflow:auto;padding:var(--s4) var(--s4) 0}
body.assistant-open .layout{grid-template-columns:minmax(360px,420px) 1fr minmax(340px,400px)}
.bubble{position:fixed;right:var(--s5);bottom:var(--s5);z-index:20;display:inline-flex;align-items:center;gap:var(--s2);min-height:52px;padding:0 var(--s5);border:0;border-radius:99px;background:var(--ink);color:#fff;font-weight:700;cursor:pointer;box-shadow:0 8px 24px rgba(31,35,40,.25)}
.bubble:hover{background:#000}.bubble .dot{width:10px;height:10px;border-radius:50%;background:var(--publish);box-shadow:0 0 0 2px var(--ink)}
body.assistant-open .bubble{display:none}
@media(max-width:1100px){body.assistant-open .layout{grid-template-columns:minmax(360px,420px) 1fr}
 .drawer{position:fixed;top:64px;right:0;bottom:0;width:min(400px,100vw);z-index:15;box-shadow:-12px 0 30px rgba(31,35,40,.15)}}
@media(max-width:600px){.drawer{top:0;width:100vw}.bubble{right:var(--s4);bottom:var(--s4)}}
.thread{list-style:none;margin:0 0 var(--s4);padding:0;display:flex;flex-direction:column;gap:var(--s3)}
.say{max-width:92%;padding:var(--s3) var(--s4);border-radius:12px;border:1px solid var(--line);background:var(--surface)}
.say.user{align-self:flex-end;background:#ECE8DE;border-color:#E2DCCF}
.say.assistant{align-self:flex-start;border-left:3px solid var(--ink)}
.say .by{display:block;font-size:var(--t-sm);color:var(--muted);font-weight:700;margin-bottom:2px}
.say .text{white-space:pre-wrap}.say.user .text{max-height:18em;overflow:auto}
.attach{display:flex;align-items:center;gap:var(--s2);margin-top:var(--s2);font-size:var(--t-sm)}.attach input{font-size:var(--t-sm);min-width:0}
.say .changed{display:inline-block;margin-top:var(--s2);font-size:var(--t-sm);color:var(--publish);font-weight:700}
.say.pending .text::after{content:"…";animation:blink 1s steps(3) infinite}@keyframes blink{50%{opacity:.2}}
@media (prefers-reduced-motion:reduce){.say.pending .text::after{animation:none}}
.empty-thread{color:var(--muted);font-size:var(--t-sm);background:var(--surface);border:1px dashed var(--line);border-radius:12px;padding:var(--s4)}
.composer{position:sticky;bottom:0;background:var(--paper);padding:var(--s3) 0 var(--s4);border-top:1px solid var(--line)}
.composer textarea{min-height:80px}.composer .foot{display:flex;justify-content:space-between;align-items:center;gap:var(--s3);margin-top:var(--s2)}
.policy{margin-top:var(--s4);padding-top:var(--s4);border-top:1px solid var(--line)}
dialog{border:0;border-radius:14px;padding:0;width:min(520px,calc(100vw - 24px));background:var(--surface);color:var(--ink)}
dialog::backdrop{background:rgba(31,35,40,.45)}
.dlg-head{display:flex;justify-content:space-between;align-items:center;padding:var(--s4) var(--s5);border-bottom:1px solid var(--line)}.dlg-head h2{margin:0;font-size:var(--t-md)}
.dlg-body{padding:var(--s4) var(--s5) var(--s5)}
.add{display:flex;gap:var(--s2)}.add input{flex:1}
.people{list-style:none;padding:0;margin:var(--s4) 0 0}.people li{display:flex;align-items:center;gap:var(--s3);padding:var(--s3) 0;border-top:1px solid var(--line)}
.people .who{flex:1;min-width:0}.people .email{font-size:var(--t-sm);color:var(--muted);overflow:hidden;text-overflow:ellipsis}
.tabs{display:none}
.pages{display:flex;flex-wrap:wrap;gap:var(--s2);margin:0 0 var(--s3)}
.pages a{display:inline-flex;align-items:center;min-height:36px;padding:0 var(--s3);border:1px solid var(--line);border-radius:99px;background:var(--surface);color:var(--ink);text-decoration:none;font-weight:700;font-size:var(--t-sm)}
.pages a[aria-current=page]{background:var(--ink);border-color:var(--ink);color:#fff}
.addpage{margin:0 0 var(--s4)}.addpage summary{cursor:pointer;font-weight:700;font-size:var(--t-sm)}.addpage .add{margin-top:var(--s2)}
.section-tools{display:flex;flex-wrap:wrap;gap:var(--s2);margin-top:var(--s4);padding-top:var(--s3);border-top:1px solid var(--line)}
.add-section{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s2);margin:var(--s3) 0 0 22px}.add-section label{margin:0;font-weight:700}.add-section select{width:auto;flex:1;min-width:10rem}
.default-submit{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.inbox{list-style:none;padding:0;margin:0 0 var(--s3)}.inbox li{padding:var(--s3) 0;border-top:1px solid var(--line)}.inbox li.new{border-left:3px solid var(--attention);padding-left:var(--s3)}
.inbox .email{font-size:var(--t-sm);color:var(--muted);overflow-wrap:anywhere}.inbox .text{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:var(--s2)}
.msg-tools{display:flex;flex-wrap:wrap;gap:var(--s2);margin-top:var(--s2)}.msg-tools form{margin:0}
.page-tools{display:flex;flex-wrap:wrap;gap:var(--s2);margin:var(--s3) 0 var(--s5)}
@media(max-width:900px){
 .top{padding:var(--s2) var(--s4);flex-wrap:wrap}.top .view{display:none}
 .layout,body.assistant-open .layout{grid-template-columns:1fr;height:auto}.panel{border-right:0;padding:var(--s4) var(--s4) 0}
 .stage{display:none;height:calc(100vh - 120px);padding:var(--s3)}.frame.phone{width:100%}
 body.show-preview .panel{display:none}body.show-preview .stage{display:flex}
 .tabs{display:flex;padding:var(--s2) var(--s4);background:var(--surface);border-bottom:1px solid var(--line)}.tabs .seg{width:100%}.tabs .seg button{flex:1}
 .stage-bar .seg{display:none}}
.state .short{display:none}
@media(max-width:600px){.top{display:grid;grid-template-columns:auto 1fr;gap:var(--s2)}.top .who{grid-column:1/-1}
 .state .long{display:none}.state .short{display:inline}.top form .btn{width:100%}}
`;

const JS = `
const $=(s)=>document.querySelector(s);
const store={get(k){try{return JSON.parse(sessionStorage.getItem(k))}catch{return null}},set(k,v){try{sessionStorage.setItem(k,JSON.stringify(v))}catch{}}};
const key='wk-ui-'+document.body.dataset.site, panel=$('.panel');
const ui=store.get(key)||{};document.querySelectorAll('details.group').forEach(d=>{if(ui.open&&ui.open.includes(d.id))d.open=true});
if(ui.scroll&&panel)panel.scrollTop=ui.scroll;
addEventListener('pagehide',()=>store.set(key,{...(store.get(key)||{}),open:[...document.querySelectorAll('details.group[open]')].map(d=>d.id),scroll:panel&&panel.scrollTop}));
const form=$('#site-form'),note=$('#save-note'),save=$('#save-btn');let dirty=false;
form&&form.addEventListener('input',()=>{if(dirty)return;dirty=true;note.textContent='You have unsaved edits.';note.classList.add('changed');save.disabled=false});
form&&form.addEventListener('submit',()=>{dirty=false;save.disabled=true;save.textContent='Saving…'});
addEventListener('beforeunload',(e)=>{if(dirty){e.preventDefault();e.returnValue=''}});
document.querySelectorAll('[data-size]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-size]').forEach(x=>x.setAttribute('aria-pressed',x===b));$('.frame').classList.toggle('phone',b.dataset.size==='phone')}));
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.setAttribute('aria-pressed',x===b));document.body.classList.toggle('show-preview',b.dataset.tab==='preview')}));
const dlg=$('#share');document.querySelectorAll('[data-open-share]').forEach(b=>b.addEventListener('click',()=>dlg.showModal()));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
if(document.body.dataset.openShare)dlg.showModal();
// assistant sidebar, opened from the bubble
const drawer=$('#assistant'),bubbleBtn=$('[data-open-assistant]');
const setAssistant=(open)=>{if(!drawer)return;drawer.hidden=!open;document.body.classList.toggle('assistant-open',open);bubbleBtn&&bubbleBtn.setAttribute('aria-expanded',open);const u=store.get(key)||{};u.assistant=open;store.set(key,u);
 if(open){bubbleBtn.querySelector('.dot').hidden=true;const t=$('#thread');t&&t.lastElementChild&&t.lastElementChild.scrollIntoView({block:'end'});$('#say')&&$('#say').focus()}else bubbleBtn&&bubbleBtn.focus()};
bubbleBtn&&bubbleBtn.addEventListener('click',()=>setAssistant(true));
document.querySelectorAll('[data-close-assistant]').forEach(b=>b.addEventListener('click',()=>setAssistant(false)));
addEventListener('keydown',(e)=>{if(e.key==='Escape'&&drawer&&!drawer.hidden&&!document.querySelector('dialog[open]'))setAssistant(false)});
if(ui.assistant)setAssistant(true);
// the shared assistant conversation
const base=document.body.dataset.base,pageRev=Number(document.body.dataset.rev),thread=$('#thread');
const esc=(t)=>String(t).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const addMsg=(m)=>{if(!thread||thread.querySelector('[data-id="'+m.id+'"]'))return;if(drawer&&drawer.hidden&&bubbleBtn)bubbleBtn.querySelector('.dot').hidden=false;const e=thread.querySelector('.empty-thread');e&&e.remove();thread.insertAdjacentHTML('beforeend',m.html);thread.dataset.last=Math.max(Number(thread.dataset.last),m.id);thread.lastElementChild.scrollIntoView({block:'end'})};
const showStale=()=>document.querySelectorAll('.stale').forEach(x=>x.hidden=false);
document.querySelectorAll('[data-reload]').forEach(b=>b.addEventListener('click',()=>location.reload()));
const refresh=async()=>{if(document.hidden||!thread)return;try{const r=await fetch(base+'/assistant/messages?after='+thread.dataset.last);if(!r.ok)return;const j=await r.json();j.messages.forEach(addMsg);if(j.rev!==pageRev)showStale()}catch{}};
setInterval(refresh,10000);
const af=$('#assistant-form');
af&&af.addEventListener('submit',async(e)=>{e.preventDefault();const ta=af.querySelector('textarea'),btn=af.querySelector('button.save'),fileIn=af.querySelector('input[type=file]'),doc=fileIn&&fileIn.files[0],text=ta.value.trim()||(doc?'Build the website from this document: '+doc.name:'');if(!text){ta.focus();return}
 btn.disabled=true;btn.textContent='Working…';ta.disabled=true;
 const e2=thread.querySelector('.empty-thread');e2&&e2.remove();
 thread.insertAdjacentHTML('beforeend','<li class="say user pending-user"><span class="by">You</span><div class="text">'+esc(text)+'</div></li><li class="say assistant pending"><span class="by">Assistant</span><div class="text">Working on it — this can take up to '+(doc?'a few minutes':'a minute')+'</div></li>');thread.lastElementChild.scrollIntoView({block:'end'});
 try{const fd=new FormData(af);fd.set('request',ta.value.trim());const r=await fetch(base+'/assistant',{method:'POST',body:fd});const j=await r.json();
  thread.querySelectorAll('.pending,.pending-user').forEach(x=>x.remove());
  if(j.error){thread.insertAdjacentHTML('beforeend','<li class="say assistant"><span class="by">Assistant</span><div class="text">'+esc(j.error)+'</div></li>')}else{j.messages.forEach(addMsg);ta.value='';if(fileIn)fileIn.value=''}
  if(j.changed&&j.changed.length){if(dirty)showStale();else{const u=store.get(key)||{};u.assistant=true;store.set(key,u);location.reload();return}}
 }catch{thread.querySelectorAll('.pending,.pending-user').forEach(x=>x.remove());thread.insertAdjacentHTML('beforeend','<li class="say assistant"><span class="by">Assistant</span><div class="text">Something went wrong reaching the assistant. Your message wasn’t sent — please try again.</div></li>')}
 btn.disabled=false;btn.textContent='Send';ta.disabled=false;ta.focus()});
$('#say')&&$('#say').addEventListener('keydown',(e)=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))af.requestSubmit()});
document.querySelectorAll('button[data-confirm]').forEach(b=>b.addEventListener('click',(e)=>{if(!confirm(b.dataset.confirm))e.preventDefault()}));
const fresh=$('details[data-new]');fresh&&fresh.scrollIntoView({block:'start'});
document.querySelectorAll('form[data-confirm]').forEach(f=>f.addEventListener('submit',(e)=>{if(!confirm(f.dataset.confirm))e.preventDefault()}));
`;

const shell = (title, siteId, body, { openShare = false, base = "", rev = 0 } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex">${FONT_LINK}<style>${CSS}</style></head>
<body data-site="${esc(siteId)}" data-base="${esc(base)}" data-rev="${rev}"${openShare ? ' data-open-share="1"' : ""}>${body}<script>${JS}</script></body></html>`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const when = (utc) => `${Number(utc.slice(8, 10))} ${MONTHS[Number(utc.slice(5, 7)) - 1]} ${utc.slice(0, 4)}, ${utc.slice(11, 16)} UTC`;

// ---------- the editor page ----------

// Messages shown after a successful action. The action redirects to ?done=<key>, so refreshing never resubmits.
const DONE = {
  saved: (site) => (site.status === "live" ? "Saved to your draft. Check the preview, then click Publish changes when you’re ready." : "Saved to your draft."),
  published: (site) => `Published. Your changes are live${site.domain ? ` on ${site.domain}` : ""} — it can take up to a minute to show everywhere.`,
  undone: () => "Undone — your draft is back to how it was before that change.",
  restored: () => "That version is now your draft. Check the preview, then Publish changes to make it live.",
  removed: () => "Removed. They can no longer edit the site.",
  adding: () => "Fill in the new section, then click Save to draft. It’s only kept once it has something in it.",
  pageAdded: () => "Page added to your draft. Fill it in below — it appears in the menu once you publish.",
  pageRemoved: () => "Page removed from your draft. It disappears from the live site when you publish.",
  pageMoved: () => "Menu order changed in your draft.",
  messagesRead: () => "All messages marked as read.",
  messageDeleted: () => "Message deleted.",
};
export const doneMessage = (key, site) => (DONE[key] ? { flash: DONE[key](site), tone: "good", openShare: key === "removed" } : {});

const ago = (utc) => {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(utc.replace(" ", "T") + "Z")) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return when(utc).replace(/, .*/, "");
};

const ACTIVITY = {
  saved: (d) => `saved${d ? `: ${d}` : ""}`, published: () => "published the site", restored: () => "loaded an older version into the draft",
  undone: () => "undid the assistant’s last change", assistant: (d) => `asked the assistant, which changed ${d}`,
  added: (d) => `added ${d}`, removed: (d) => `removed ${d}`, policy: (d) => d, pages: (d) => d,
  suggested: (d) => `suggested a new feature: ${d}`,
  agent: (d) => `used ${d.replace(/: /, " to change ")}`,
};

export const logActivity = (env, siteId, editorId, kind, detail = "") =>
  env.DB.prepare("INSERT INTO activity (site_id, editor_id, kind, detail) VALUES (?, ?, ?, ?)").bind(siteId, editorId, kind, String(detail).slice(0, 300)).run();

export const canPublish = (site, editor) => site.publish_policy !== "owner" || editor.role === "owner" || editor.is_admin;

const bubble = (m) => `<li class="say ${m.role}" data-id="${m.id}"><span class="by">${esc(m.role === "assistant" ? "Assistant" : m.author)} · ${esc(ago(m.created_at))}</span><div class="text">${esc(m.content)}</div>${m.changed ? `<span class="changed">Changed in draft: ${esc(m.changed)}</span>` : ""}</li>`;

export const threadRows = (env, siteId, after = 0) => env.DB.prepare(
  "SELECT m.id, m.role, m.content, m.changed, m.created_at, COALESCE(e.name, e.email, 'Someone') AS author FROM agent_messages m LEFT JOIN editors e ON e.id = m.editor_id WHERE m.site_id = ? AND m.id > ? ORDER BY m.id DESC LIMIT 40"
).bind(siteId, after).all().then((r) => r.results.reverse());
export const bubbleHtml = bubble;

export async function editorView(env, ctx, { flash = "", tone = "", errors = [], formConfig = null, notice = "", openShare = false, page = "", add = "" } = {}) {
  const { site, editor, base } = ctx;
  const live = site.status === "live";
  const unpublished = (site.draft || site.config) !== site.config;
  const [{ results: people }, { results: versions }, canUndo, { results: activity }, thread, inbox] = await Promise.all([
    env.DB.prepare("SELECT id, name, email, role, is_admin FROM editors WHERE site_id = ? AND revoked_at IS NULL ORDER BY is_admin, role = 'owner' DESC, created_at").bind(site.id).all(),
    env.DB.prepare("SELECT v.id, v.created_at, e.name, e.email FROM site_versions v LEFT JOIN editors e ON e.id = v.editor_id WHERE v.site_id = ? ORDER BY v.id DESC LIMIT 10").bind(site.id).all(),
    env.DB.prepare("SELECT 1 FROM ai_edits WHERE site_id = ? AND undone = 0 AND after_rev = ?").bind(site.id, site.draft_rev).first(),
    env.DB.prepare("SELECT a.kind, a.detail, a.created_at, COALESCE(e.name, e.email, 'Someone') AS who FROM activity a LEFT JOIN editors e ON e.id = a.editor_id WHERE a.site_id = ? ORDER BY a.id DESC LIMIT 15").bind(site.id).all(),
    threadRows(env, site.id),
    messageRows(env, site.id),
  ]);
  const cfg = formConfig || draftOf(site);
  const pages = normalize(cfg).pages;
  const current = page ? (cfg.pages || []).find((p) => p.slug === page) : null; // raw when re-showing errors, so input stays as typed
  const owner = editor.role === "owner" || editor.is_admin;
  const mayPublish = canPublish(site, editor);
  const where = live && site.domain ? site.domain : "your site";
  const rev = `<input type="hidden" name="rev" value="${site.draft_rev}">`;
  const state = !live ? `<span class="state review">In review — we’ll publish it with you</span>`
    : unpublished ? `<span class="state changed"><span class="long">Draft has changes that aren’t on ${esc(where)} yet${mayPublish ? "" : " — the owner publishes"}</span><span class="short">Unpublished changes</span></span>`
    : `<span class="state"><span class="long">Live — ${esc(where)} matches your draft${versions[0] ? `, published ${when(versions[0].created_at)}` : ""}</span><span class="short">Live · up to date</span></span>`;
  const publishBtn = !live ? "" : mayPublish
    ? `<form method="post" action="${base}/publish">${rev}<button class="btn publish"${unpublished ? "" : ` disabled title="Nothing new to publish"`}>Publish changes</button></form>`
    : `<button class="btn publish" disabled title="On this site only the owner can publish">Owner publishes</button>`;
  const messages = [
    flash ? `<div class="msg ${tone}" role="status">${esc(flash)}</div>` : "",
    notice,
    errors.length ? `<div class="msg warn" role="alert"><strong>Your draft wasn’t saved. Please fix:</strong><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : "",
  ].join("");
  const stale = `<div class="msg warn stale" hidden role="status">The draft has changed since you opened this page. <button type="button" class="btn small" data-reload>Show the latest</button></div>`;
  const form = editorGroups(cfg, { page: current, add });
  const hasForm = [draftOf(site), JSON.parse(site.config)].map(normalize).some((c) => [c, ...c.pages].some((p) => p.sections.some((s) => s.type === "form")));
  const groups = form.groups.map((g) => `<details class="group" id="g-${g.id}"${g.open ? " open data-new" : ""}><summary>${esc(g.title)}${g.chip && g.chip !== g.title ? `<span class="chip">${esc(g.chip)}</span>` : ""}</summary><div class="group-body">${g.body}</div></details>`).join("");

  const body = `
<header class="top">
  <div class="who"><div class="site">${esc(cfg.name || "Your website")}</div>${state}</div>
  ${live && site.domain ? `<a class="btn quiet view" href="https://${esc(site.domain)}" target="_blank" rel="noopener">View live site</a>` : ""}
  <button class="btn" type="button" data-open-share>Share</button>
  ${publishBtn}
</header>
<nav class="tabs" aria-label="Switch view"><div class="seg"><button type="button" data-tab="edit" aria-pressed="true">Edit</button><button type="button" data-tab="preview" aria-pressed="false">Preview</button></div></nav>
<div class="layout">
<section class="panel" aria-label="Edit your website">
  <p class="explain">You’re editing a private draft. ${live ? `Visitors to ${esc(where)} see your changes only after ${mayPublish ? "you click <strong>Publish changes</strong>" : "the owner publishes them"}.` : "Nothing is public until we review the site with you."}</p>
  ${stale}${messages}
  <nav class="pages" aria-label="Pages"><a href="${base}"${current ? "" : ' aria-current="page"'}>Home</a>${pages.map((p) => `<a href="${base}?page=${encodeURIComponent(p.slug)}"${current?.slug === p.slug ? ' aria-current="page"' : ""}>${esc(p.title)}</a>`).join("")}</nav>
  ${pages.length < MAX_PAGES ? `<details class="addpage"><summary>+ Add a page</summary><form class="add" method="post" action="${base}/pages/add">${rev}<label for="new-page" class="sr">Page name</label><input id="new-page" name="title" maxlength="40" placeholder="Page name, like About" required><button class="btn save">Add page</button></form>
    <p class="hint">Each page gets its own tab in the menu and its own address. With no extra pages, the menu scrolls down one page.</p></details>` : ""}
  <p class="list-title">${current ? `The “${esc(current.title)}” page, top to bottom` : pages.length ? "Home page, top to bottom" : "Your page, top to bottom"}</p>
  <form id="site-form" method="post" action="${base}/save" enctype="multipart/form-data">${rev}${current ? `<input type="hidden" name="page" value="${esc(current.slug)}">` : ""}<input type="hidden" name="count" value="${form.count}">
    <button class="default-submit" tabindex="-1" aria-hidden="true">Save</button><!-- Enter in a field saves, rather than pressing the first Move button -->
    <div class="groups">${groups}</div>${form.addRow}
    <div class="savebar"><button id="save-btn" class="btn save" disabled>Save to draft</button>
      <span id="save-note" class="note">${unpublished && live ? "All edits saved to your draft. Not public yet." : "No unsaved edits."}</span>
      ${live && unpublished && mayPublish ? `<button class="btn publish" form="publish-bottom">Publish changes</button>` : ""}</div>
  </form>
  ${live && unpublished && mayPublish ? `<form id="publish-bottom" method="post" action="${base}/publish">${rev}</form>` : ""}
  ${current ? `<div class="page-tools">${["left", "right"].map((d) => `<form method="post" action="${base}/pages/move">${rev}<input type="hidden" name="page" value="${esc(current.slug)}"><input type="hidden" name="dir" value="${d}"><button class="btn small">Move ${d} in the menu</button></form>`).join("")}
    <form method="post" action="${base}/pages/remove" data-confirm="Remove the “${esc(current.title)}” page and everything on it from your draft?">${rev}<input type="hidden" name="page" value="${esc(current.slug)}"><button class="btn small danger">Remove this page</button></form></div>` : ""}

  ${hasForm || inbox.length ? messagesPanel(inbox, { base, siteName: cfg.name, ago }) : ""}
  <details class="group" id="g-activity"><summary>Recent activity</summary><div class="group-body">${activity.length
    ? `<ul class="history">${activity.map((a) => `<li><span><strong>${esc(a.who)}</strong> ${esc((ACTIVITY[a.kind] || ((d) => d))(a.detail))}</span><span class="hint">${esc(ago(a.created_at))}</span></li>`).join("")}</ul>`
    : `<p class="hint">Nothing yet. Saves, publishes and assistant changes by anyone on your team will show here.</p>`}</div></details>
  ${versions.length ? `<details class="group" id="g-history"><summary>Published versions</summary><div class="group-body"><ul class="history">${versions.map((v, i) => `<li><span>${when(v.created_at)}${v.name || v.email ? ` · ${esc(v.name || v.email)}` : ""}${i === 0 ? " · <strong>live now</strong>" : ""}</span>
    <form method="post" action="${base}/restore/${v.id}">${rev}<button class="btn small">${i === 0 ? "Discard draft edits" : "Load into draft"}</button></form></li>`).join("")}</ul>
    <p class="hint">Loading an older version replaces your draft so you can preview it. Publish to make it live again.</p></div></details>` : ""}
  <div class="signed">Signed in as ${esc(editor.email)} · <form method="post" action="${base}/signout" style="display:inline"><button class="btn quiet">Sign out</button></form></div>
</section>
<section class="stage" aria-label="Preview">
  <div class="stage-bar"><span class="label">Preview of your draft</span><div class="seg" role="group" aria-label="Preview size"><button type="button" data-size="desktop" aria-pressed="true">Desktop</button><button type="button" data-size="phone" aria-pressed="false">Phone</button></div></div>
  <div class="frame-wrap"><iframe class="frame" src="${base}/preview?rev=${site.draft_rev}${current ? `&page=${encodeURIComponent(current.slug)}` : ""}" title="Preview of your draft"></iframe></div>
</section>
<aside id="assistant" class="drawer" aria-labelledby="assistant-title" hidden>
  <div class="drawer-head"><h2 id="assistant-title">Assistant</h2><button type="button" class="btn quiet" data-close-assistant>Close</button></div>
  <div class="drawer-body">
    <p class="explain">Ask for changes in your own words. The assistant edits your draft — you still check the preview and publish. Everyone on your team sees this conversation.</p>
    ${stale}
    <ol id="thread" class="thread" data-last="${thread.length ? thread[thread.length - 1].id : 0}" aria-live="polite">${thread.length ? thread.map(bubble).join("")
      : `<li class="empty-thread">Try: “Make the colours warmer”, “Put About on its own page”, or attach a Word document with your website copy and ask it to build the site.</li>`}</ol>
    <form id="assistant-form" class="composer" method="post" action="${base}/assistant" enctype="multipart/form-data">
      <label for="say" class="sr">Message the assistant</label>
      <textarea id="say" name="request" maxlength="20000" placeholder="What would you like to change? You can also paste your website copy here."></textarea>
      <div class="attach"><label for="doc">Or attach your website copy</label><input id="doc" name="doc" type="file" accept=".docx,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"></div>
      <div class="foot"><span class="hint">${PER_SITE_DAILY} requests a day for your team</span><button class="btn save">Send</button></div>
    </form>
    ${canUndo ? `<form method="post" action="${base}/undo">${rev}<button class="btn small">Undo the assistant’s last change</button></form>` : ""}
  </div>
</aside>
</div>
<button type="button" class="bubble" data-open-assistant aria-controls="assistant" aria-expanded="false"><span aria-hidden="true">✦</span> Ask the assistant<span class="dot" hidden></span></button>

<dialog id="share" aria-labelledby="share-title">
  <div class="dlg-head"><h2 id="share-title">Who can edit</h2><button class="btn quiet" type="button" data-close>Close</button></div>
  <div class="dlg-body">
    <p class="hint" style="margin-top:0">Add someone’s email address. They open ${esc(live && site.domain ? `${site.domain}/edit` : "this page")} and sign in with Google using that address — there’s no password to set up.${googleReady(env) ? "" : " <strong>Google sign-in isn’t switched on yet</strong>, so for now the owner copies a sign-in link for each person."}</p>
    <form class="add" method="post" action="${base}/people"><label for="add-email" class="sr">Email address</label><input id="add-email" type="email" name="email" placeholder="name@example.org" required><button class="btn save">Add</button></form>
    <ul class="people">${people.map((p) => `<li><span class="who"><strong>${esc(p.name || p.email)}</strong>${p.is_admin ? " <span class=\"hint\">· Website Kit support</span>" : p.role === "owner" ? " <span class=\"hint\">· owner</span>" : ""}${p.id === editor.id ? " <span class=\"hint\">· you</span>" : ""}<div class="email">${esc(p.email)}</div></span>
      ${!googleReady(env) && owner ? `<form method="post" action="${base}/people/${p.id}/link"><button class="btn small">Copy link</button></form>` : ""}
      ${owner && p.id !== editor.id && !p.is_admin ? `<form method="post" action="${base}/people/${p.id}/remove" data-confirm="Remove ${esc(p.email)}? They won’t be able to edit any more."><button class="btn small danger">Remove</button></form>` : ""}</li>`).join("")}</ul>
    <p class="hint">Anyone on this list can add people. Only the owner can remove them.</p>
    ${owner ? `<form class="policy" method="post" action="${base}/people/policy"><label class="inline"><input type="checkbox" name="ownerOnly" value="1"${site.publish_policy === "owner" ? " checked" : ""} onchange="this.form.submit()"> Only the owner can publish changes</label>
      <p class="hint">Turn this on if you want to review your team’s edits before they go live.</p><noscript><button class="btn small">Save</button></noscript></form>`
      : site.publish_policy === "owner" ? `<p class="hint"><strong>On this site, only the owner publishes.</strong> Save your edits to the draft and let them know.</p>` : ""}
  </div>
</dialog>`;
  return shell(`Edit · ${cfg.name || "website"}`, site.id, body, { openShare, base, rev: site.draft_rev });
}

const smallPage = (title, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex">${FONT_LINK}<style>${TOOL_CSS}
.box{max-width:440px;margin:12vh auto;padding:var(--s6);background:var(--surface);border:1px solid var(--line);border-radius:14px}
.box p{color:var(--muted)}.g{width:100%;margin-top:var(--s4)}@media(max-width:480px){.box{margin:var(--s4);padding:var(--s5)}}</style></head>
<body><main class="box">${inner}</main></body></html>`;

const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.8 6c1.9-5.6 7.2-9.8 13.6-9.8z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17z"/><path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.5 2.2-6.4 0-11.8-4.2-13.7-9.9l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>`;

export const signInPage = (siteName, googleUrl) => smallPage("Sign in", `<h1>Edit ${esc(siteName || "this website")}</h1>
<p>Sign in with the Google account for the email address you were added with.</p>
${googleUrl ? `<a class="btn g" href="${esc(googleUrl)}">${GOOGLE_G} Sign in with Google</a>` : `<p class="notice">Google sign-in isn’t switched on yet. Open the sign-in link you were sent instead.</p>`}
<p class="hint">Not on the list? Ask whoever manages this website to add your email address.</p>`);

export const messagePage = (title, text) => smallPage(title, `<h1>${esc(title)}</h1><p>${text}</p>`);

const linkNotice = (title, url) => `<div class="msg" role="status"><strong>${esc(title)}</strong><br><code>${esc(url)}</code><br><span class="hint">Works for 7 days. Anyone who has it can edit, so send it only to them.</span></div>`;

// ---------- actions ----------

export async function editorPost(env, ctx, action, form) {
  const { site, editor, origin } = ctx;
  const rev = Number(form.get("rev"));

  if (action === "save") {
    const slug = String(form.get("page") || "");
    const onPage = slug && normalize(draftOf(site)).pages.some((p) => p.slug === slug);
    if (slug && !onPage) return { flash: "That page was removed while you were editing, so your edits weren’t saved.", tone: "warn", page: "" };
    const r = await buildEditorForm(env, site.id, form, draftOf(site), onPage ? slug : "");
    if (r.errors.length) return { errors: r.errors, formConfig: r.raw, page: slug };
    if (JSON.stringify(normalize(draftOf(site))) !== JSON.stringify(r.config)) { // "Add a section" with no edits saves nothing
      if (!(await saveDraft(env, site, rev, r.config))) return { ...CONFLICT, page: slug };
      await logActivity(env, site.id, editor.id, "saved", describeChanges(draftOf(site), r.config).join(", "));
    }
    return { done: r.add ? "adding" : "saved", page: r.slug || "", add: r.add };
  }

  if (action.startsWith("pages/")) {
    const cfg = normalize(draftOf(site));
    const slug = String(form.get("page") || "");
    const i = cfg.pages.findIndex((p) => p.slug === slug);
    let done, detail, keep = slug;
    if (action === "pages/add") {
      const title = String(form.get("title") || "").trim().slice(0, 40);
      if (!title) return { flash: "Give the page a name first.", tone: "warn" };
      if (cfg.pages.length >= MAX_PAGES) return { flash: `A site can have up to ${MAX_PAGES} pages besides Home.`, tone: "warn" };
      keep = uniqueSlug(toSlug(title), new Set(cfg.pages.map((p) => p.slug)));
      cfg.pages.push({ title, slug: keep, sections: [{ type: "hero", heading: title }] });
      [done, detail] = ["pageAdded", `added the “${title}” page`];
    } else if (i < 0) {
      return { flash: "That page wasn’t found — someone may have removed it.", tone: "warn", page: "" };
    } else if (action === "pages/remove") {
      const [gone] = cfg.pages.splice(i, 1);
      [done, detail, keep] = ["pageRemoved", `removed the “${gone.title}” page`, ""];
    } else if (action === "pages/move") {
      const j = i + (form.get("dir") === "left" ? -1 : 1);
      if (j < 0 || j >= cfg.pages.length) return { flash: "It’s already at that end of the menu.", page: slug };
      [cfg.pages[i], cfg.pages[j]] = [cfg.pages[j], cfg.pages[i]];
      [done, detail] = ["pageMoved", "changed the menu order"];
    } else return null;
    if (!(await saveDraft(env, site, rev, cfg))) return { ...CONFLICT, page: keep };
    await logActivity(env, site.id, editor.id, "pages", detail);
    return { done, page: keep };
  }

  if (action.startsWith("messages/")) return messagesPost(env, site, action);

  if (action === "undo") {
    const last = await env.DB.prepare("SELECT id, before_config FROM ai_edits WHERE site_id = ? AND undone = 0 AND after_rev = ? ORDER BY id DESC LIMIT 1")
      .bind(site.id, site.draft_rev).first(); // only while nothing else has changed the draft since
    if (!last) return { flash: "There’s nothing to undo — the draft has changed since that request." };
    if (!(await saveDraft(env, site, rev, JSON.parse(last.before_config)))) return CONFLICT;
    await env.DB.prepare("UPDATE ai_edits SET undone = 1 WHERE id = ?").bind(last.id).run();
    await logActivity(env, site.id, editor.id, "undone");
    return { done: "undone" };
  }

  if (action === "publish") {
    if (site.status !== "live") return { flash: "This site goes live after our review." };
    if (!canPublish(site, editor)) return { flash: "On this site only the owner can publish. Your edits are saved in the draft — let them know it’s ready.", tone: "warn" };
    if (rev !== site.draft_rev) return { flash: "The draft changed since you loaded this page. Check the preview, then publish.", tone: "warn" };
    await publish(env, site.id, editor.id);
    await logActivity(env, site.id, editor.id, "published");
    return { done: "published" };
  }

  const restore = action.match(/^restore\/(\d+)$/);
  if (restore) {
    const v = await env.DB.prepare("SELECT config FROM site_versions WHERE id = ? AND site_id = ?").bind(restore[1], site.id).first();
    if (!v) return { flash: "That version wasn’t found." };
    if (!(await saveDraft(env, site, rev, JSON.parse(v.config)))) return CONFLICT;
    await logActivity(env, site.id, editor.id, "restored");
    return { done: "restored" };
  }

  if (action === "people") {
    const r = await addEditor(env, { siteId: site.id, email: form.get("email"), createdBy: editor.id });
    if (r.error) return { flash: r.error, tone: "warn", openShare: true };
    await logActivity(env, site.id, editor.id, "added", r.email);
    return { flash: googleReady(env) ? `Added ${r.email}. Tell them to open ${origin}/edit and sign in with Google.` : `Added ${r.email}. Use “Copy link” to send them a way in.`, tone: "good", openShare: true };
  }

  if (action === "people/policy") {
    if (editor.role !== "owner" && !editor.is_admin) return { flash: "Only the owner can change who publishes.", tone: "warn", openShare: true };
    const policy = form.get("ownerOnly") ? "owner" : "anyone";
    await env.DB.prepare("UPDATE sites SET publish_policy = ? WHERE id = ?").bind(policy, site.id).run();
    await logActivity(env, site.id, editor.id, "policy", policy === "owner" ? "made publishing owner-only" : "let anyone on the team publish");
    return { flash: policy === "owner" ? "Done — only the owner can publish now. Others can still save to the draft." : "Done — anyone on the team can publish now.", tone: "good", openShare: true };
  }

  const person = action.match(/^people\/([0-9a-f]{16})\/(remove|link)$/);
  if (person) {
    if (editor.role !== "owner" && !editor.is_admin) return { flash: "Only the owner can do that.", openShare: true };
    const p = await env.DB.prepare("SELECT id, email, is_admin FROM editors WHERE id = ? AND site_id = ? AND revoked_at IS NULL").bind(person[1], site.id).first();
    if (!p) return { flash: "That person wasn’t found.", openShare: true };
    if (p.is_admin && person[2] === "remove") return { flash: "Website Kit support can’t be removed here — contact us if you need that.", tone: "warn", openShare: true };
    if (person[2] === "remove") {
      if (p.id === editor.id) return { flash: "You can’t remove yourself.", openShare: true };
      await env.DB.batch([
        env.DB.prepare("UPDATE editors SET revoked_at = datetime('now') WHERE id = ?").bind(p.id),
        env.DB.prepare("DELETE FROM sessions WHERE editor_id = ?").bind(p.id),
        env.DB.prepare("DELETE FROM handoffs WHERE editor_id = ?").bind(p.id),
      ]);
      await logActivity(env, site.id, editor.id, "removed", p.email);
      return { done: "removed" };
    }
    if (googleReady(env)) return { flash: "People sign in with Google now — no link needed.", openShare: true };
    const code = await makeHandoff(env, p.id, "link");
    return { notice: linkNotice(`Sign-in link for ${p.email}`, `${origin}/signin/${code}`) };
  }
  return null;
}

// Also used by admin approval: draft → live, with a version row for rollback.
export async function publish(env, siteId, editorId = null) {
  await env.DB.batch([
    env.DB.prepare("UPDATE sites SET config = COALESCE(draft, config), updated_at = datetime('now') WHERE id = ?").bind(siteId),
    env.DB.prepare("INSERT INTO site_versions (site_id, config, editor_id) SELECT id, config, ? FROM sites WHERE id = ?").bind(editorId, siteId),
  ]);
}
