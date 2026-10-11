export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const color = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(v || "") ? v : fallback);

export const page = (body, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
      ...headers,
    },
  });

// Design tokens for the tool UI (portal, admin, /edit). Org sites have their own themes in site.js.
export const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;600;700&family=Atkinson+Hyperlegible:wght@400;700&display=swap">`;

export const TOOL_CSS = `
:root{--paper:#F6F3EC;--surface:#FFFFFF;--ink:#1F2328;--muted:#5B606A;--line:#D9D4C8;--publish:#0E6B4E;--attention:#9A3F0B;
--t-sm:13px;--t-base:16px;--t-md:19px;--t-lg:23px;--t-xl:28px;--s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:24px;--s6:32px;--s7:48px;--r:10px;
font-family:"Atkinson Hyperlegible Next","Atkinson Hyperlegible",system-ui,sans-serif;font-size:var(--t-base)}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);line-height:1.5}
button,input,textarea,select{font:inherit;color:inherit}
h1{font-size:var(--t-xl);line-height:1.2;margin:0 0 var(--s3)}h2{font-size:var(--t-lg);line-height:1.2;margin:var(--s6) 0 var(--s3)}h3{font-size:var(--t-md);margin:0 0 var(--s2)}
a{color:var(--ink);text-underline-offset:3px}
:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.hint{font-weight:400;color:var(--muted);font-size:var(--t-sm)}
label{display:block;font-weight:700;margin:var(--s4) 0 var(--s1)}label.inline{display:inline-flex;gap:var(--s2);align-items:center;font-weight:400;margin:0}
input[type=text],input[type=email],input[type=tel],textarea,select{width:100%;padding:10px 12px;border:1px solid #BDB7AA;border-radius:8px;background:var(--surface);min-height:44px}
textarea{min-height:96px;resize:vertical}
input[type=file]{display:block;width:100%;font-size:var(--t-sm);color:var(--muted)}
input[type=file]::file-selector-button{font:inherit;font-weight:700;color:var(--ink);background:var(--surface);border:1.5px solid var(--ink);border-radius:8px;min-height:40px;padding:0 var(--s3);margin-right:var(--s3);cursor:pointer}
input[type=color]{width:44px;height:44px;padding:3px;border:1px solid #BDB7AA;border-radius:8px;background:var(--surface);flex:none}
.colors{display:grid;gap:var(--s2);margin-top:var(--s4)}.color-field{display:flex;align-items:center;gap:var(--s3)}.color-field label{flex:1;margin:0}
.color-pair{display:flex;gap:var(--s2)}.color-pair input[type=text]{width:7.5rem;font-family:ui-monospace,Menlo,monospace;font-size:var(--t-sm)}
input[type=radio],input[type=checkbox]{accent-color:var(--ink);width:18px;height:18px}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s3)}.row2{display:grid;grid-template-columns:1fr 1.6fr;gap:var(--s3)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--s2);min-height:44px;padding:0 var(--s4);border-radius:8px;border:1.5px solid var(--ink);background:var(--surface);font-weight:700;text-decoration:none;cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--paper)}.btn.save{background:var(--ink);color:#fff}.btn.save:hover{background:#000}
.btn.publish{background:var(--publish);border-color:var(--publish);color:#fff}.btn.publish:hover{background:#0A573F}
.btn[disabled]{opacity:.5;cursor:not-allowed}.btn.quiet{border-color:transparent;background:none;text-decoration:underline;min-height:36px;padding:0 var(--s2)}
.btn.danger{color:var(--attention);border-color:var(--attention)}.btn.quiet.danger{border-color:transparent}.btn.small{min-height:36px;padding:0 var(--s3);font-size:var(--t-sm)}
.msg{border-radius:var(--r);padding:var(--s3) var(--s4);margin-bottom:var(--s4);background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--ink)}
.msg.good{border-left-color:var(--publish)}.msg.warn{border-left-color:var(--attention)}.msg ul{margin:var(--s2) 0 0;padding-left:20px}
.notice{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:var(--s3) var(--s4);font-size:var(--t-sm)}
.thumb{display:flex;align-items:center;gap:var(--s3);margin-bottom:var(--s2)}.thumb img{width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--line);background:var(--paper)}
.presets{display:grid;grid-template-columns:1fr 1fr;gap:var(--s2);margin-top:var(--s3)}
.preset{display:flex;gap:var(--s2);align-items:flex-start;margin:0;padding:var(--s3);border:1.5px solid var(--line);border-radius:var(--r);background:var(--surface);cursor:pointer;font-weight:400}
.preset:has(input:checked){border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}.preset input{margin-top:4px}.preset strong{display:block}
details.more{margin-top:var(--s4)}details.more>summary{cursor:pointer;font-weight:700}
code{background:#ECE8DE;padding:2px 6px;border-radius:5px;word-break:break-all;font-size:var(--t-sm)}
@media(max-width:560px){.row,.row2,.presets{grid-template-columns:1fr}}
`;

// Shared shell for portal pages (intake, admin) — not the org sites themselves.
export const portalShell = (title, inner) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${FONT_LINK}
<style>${TOOL_CSS}
main{width:min(760px,100% - 32px);margin:var(--s7) auto}
p.lead{color:var(--muted);font-size:var(--t-md);margin-top:0}
fieldset{min-width:0;border:1px solid var(--line);border-radius:var(--r);padding:var(--s5);margin:var(--s5) 0;background:var(--surface)}
legend{font-weight:700;font-size:var(--t-md);padding:0 var(--s2)}
.spine{position:relative;padding-left:26px}.spine::before{content:"";position:absolute;left:7px;top:34px;bottom:34px;width:2px;background:var(--line)}
.spine fieldset{position:relative}.spine fieldset::before{content:"";position:absolute;left:-26px;top:6px;width:14px;height:14px;border-radius:50%;background:var(--ink);box-shadow:0 0 0 4px var(--paper)}
table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
th,td{text-align:left;padding:var(--s3);border-bottom:1px solid var(--line);vertical-align:top;font-size:var(--t-sm)}
td form{margin:0 0 var(--s2)}td input{min-height:36px}
.pill{display:inline-block;padding:2px 10px;border-radius:99px;font-size:var(--t-sm);font-weight:700;border:1px solid var(--line)}
.pill.live{color:var(--publish);border-color:var(--publish)}.pill.pending{color:var(--attention);border-color:var(--attention)}
button:not(.btn){display:inline-flex;align-items:center;min-height:44px;padding:0 var(--s4);border-radius:8px;border:1.5px solid var(--ink);background:var(--ink);color:#fff;font-weight:700;cursor:pointer}
.btn.secondary,button.btn.secondary{background:var(--surface);color:var(--ink)}
.site{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:var(--s4) var(--s5);margin-bottom:var(--s3)}
.site h3{display:inline;margin-right:var(--s2)}.site-head{display:flex;justify-content:space-between;align-items:center;gap:var(--s3);flex-wrap:wrap}
.site-head .pill{margin-right:var(--s2)}.site-head a{font-size:var(--t-sm)}
.site-forms{display:grid;grid-template-columns:1fr 1fr;gap:var(--s3);margin-top:var(--s3)}
form.inline{display:flex;align-items:center;gap:var(--s2)}form.inline label{margin:0;font-size:var(--t-sm);white-space:nowrap}form.inline input{min-width:0}
.site-actions{display:flex;gap:var(--s2);margin:var(--s2) 0 0 calc(var(--s2) * -1)}.site p.hint{margin:var(--s2) 0 0}
.invites{list-style:none;padding:0;margin:var(--s4) 0}.invites li{display:flex;flex-direction:column;gap:var(--s1);padding:var(--s3) 0;border-top:1px solid var(--line)}
@media(max-width:700px){.site-forms{grid-template-columns:1fr}form.inline{flex-wrap:wrap}form.inline input{flex:1 1 12rem}.site{padding:var(--s4)}}
</style></head><body><main>${inner}</main>
<script>document.querySelectorAll("form[data-confirm]").forEach((f)=>f.addEventListener("submit",(e)=>{if(!confirm(f.dataset.confirm))e.preventDefault()}))</script></body></html>`;
