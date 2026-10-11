import { esc, page, portalShell } from "./html.js";
import { renderSite, SITE_CSS } from "./site.js";
import { intakeForm, handleIntakePost } from "./portal.js";
import { isAdmin, challenge, adminView, adminPost } from "./admin.js";
import { editorView, editorPost, loadSite, signInPage, messagePage, doneMessage, threadRows, bubbleHtml, logActivity } from "./editor.js";
import { assistantTurn, overLimit } from "./ai.js";
import { docText } from "./doctext.js";
import { connector, authorize, finishSignIn } from "./connector.js";
import { currentEditor, redeemHandoff, startSession, endSession, addEditor, makeHandoff, sessionCookie, clearCookie, googleReady, googleStartUrl, googleStart, googleCallback, currentAdmin, ensureAdminEditor, portalOrigin } from "./auth.js";

const notFound = () => page(portalShell("Not found", "<h1>Not found</h1>"), 404);
const PRIVATE = { "cache-control": "no-store", "x-robots-tag": "noindex", "content-security-policy": "frame-ancestors 'self'" }; // same-origin framing only: blocks clickjacking, allows the editor's own preview
const formOf = (request) => request.formData().catch(() => new FormData()); // a bodyless POST has nothing to parse
const redirect = (to, headers = {}) => new Response(null, { status: 303, headers: { location: to, ...headers } });

// The portal also hosts the agent connector (/mcp, OAuth endpoints) once its KV store exists; org domains never do.
export default {
  fetch(request, env, ctx) {
    const host = new URL(request.url).hostname.replace(/^www\./, "");
    return env.OAUTH_KV && googleReady(env) && isPortalHost(host, env) ? connector(env, app).fetch(request, env, ctx) : app.fetch(request, env, ctx);
  },
};

const app = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.replace(/^www\./, "");

    if (url.pathname === "/_kit/site.css")
      return new Response(SITE_CSS, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=300" } });
    if (url.pathname.startsWith("/media/")) return media(env, url.pathname.slice(7));

    // Admin uses Basic auth and editors use cookies; both ride along on cross-site requests, so every POST must come from this origin.
    if (request.method === "POST" && request.headers.get("origin") !== url.origin) return new Response("Bad origin", { status: 403 });

    const signin = url.pathname.match(/^\/signin\/([0-9a-f]{32})$/); // a handoff code: from Google sign-in or an admin link
    const portal = isPortalHost(host, env);

    // An org's own domain: its live site, plus /edit and sign-in links for that site only.
    if (!portal) {
      const site = await env.DB.prepare("SELECT * FROM sites WHERE domain = ? AND status = 'live'").bind(host).first();
      if (!site) return notFound();
      if (signin) return signIn(env, signin[1], site.id, "/edit");
      const edit = url.pathname.match(/^\/edit(?:\/(.+))?$/);
      if (edit) return editRoute(request, env, { site, base: "/edit", origin: url.origin }, edit[1]);
      const slug = url.pathname === "/" ? "" : url.pathname.match(/^\/([a-z0-9-]{1,40})\/?$/)?.[1];
      const html = slug !== undefined && renderSite(JSON.parse(site.config), { page: slug });
      return html ? page(html, 200, { "cache-control": "public, max-age=60" }) : notFound();
    }

    if (signin) return signIn(env, signin[1], null, null);
    if (url.pathname === "/auth/google" && googleReady(env)) {
      const to = await googleStart(env, url);
      return to ? Response.redirect(to, 302) : notFound();
    }
    if (url.pathname === "/authorize" && env.OAUTH_PROVIDER) return authorize(request, env);
    if (url.pathname === "/auth/google/callback" && googleReady(env)) {
      const ours = await env.DB.prepare("SELECT 1 FROM login_states WHERE state = ?").bind(url.searchParams.get("state") || "").first();
      if (!ours && env.OAUTH_PROVIDER) return finishSignIn(request, env); // a sign-in started by an AI app connecting
      const r = await googleCallback(env, url);
      if (r.redirect) return new Response(null, { status: 302, headers: { location: r.redirect, ...(r.cookie ? { "set-cookie": r.cookie } : {}) } });
      return page(messagePage("Couldn’t sign you in", `${esc(r.error)}${r.retry ? `<br><br><a class="btn" href="${esc(r.retry)}">Try a different Google account</a>` : ""}`), 403, PRIVATE);
    }
    const edit = url.pathname.match(/^\/edit\/([0-9a-f]{16})(?:\/(.+))?$/);
    if (edit) {
      const site = await loadSite(env, edit[1]);
      return site ? editRoute(request, env, { site, base: `/edit/${site.id}`, origin: url.origin }, edit[2]) : notFound();
    }

    const start = url.pathname.match(/^\/start\/([0-9a-f]{20})$/);
    if (start) return intake(request, env, start[1], url.origin);

    const preview = url.pathname.match(/^\/preview\/([0-9a-f]{16})$/);
    if (preview) {
      const site = await env.DB.prepare("SELECT COALESCE(draft, config) AS config FROM sites WHERE id = ? AND status != 'archived'").bind(preview[1]).first();
      const html = site && renderSite(JSON.parse(site.config), { page: url.searchParams.get("page") || "", href: previewHref(url.pathname) });
      return html ? page(html, 200, { "x-robots-tag": "noindex", "cache-control": "no-store" }) : notFound();
    }

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      const admin = isAdmin(request, env) || (await currentAdmin(request, env));
      if (!admin) return googleReady(env) && url.host === env.PORTAL_HOST
        ? page(signInPage("Website Kit admin", googleStartUrl(env, "admin", portalOrigin(env))), 401, PRIVATE)
        : challenge();
      if (request.method === "POST") {
        const flash = await adminPost(env, url, await formOf(request));
        return flash === null ? notFound() : page(await adminView(env, url.origin, flash), 200, PRIVATE);
      }
      return page(await adminView(env, url.origin), 200, PRIVATE);
    }

    if (url.pathname === "/")
      return page(portalShell("Website Kit", `<h1>Website Kit</h1><p class="lead">Websites for community organizations, hosted and looked after for you. This service is invite-only — if someone sent you a link, use that.</p><p><a href="/privacy">Privacy</a></p>`));
    if (url.pathname === "/privacy") return page(portalShell("Privacy — Website Kit", privacy(env)), 200, { "cache-control": "public, max-age=3600" });
    return notFound();
  },
};

// Preview links stay in the preview (and the draft) instead of jumping to the live site.
const previewHref = (path) => (slug) => (slug ? `${path}?page=${encodeURIComponent(slug)}` : path);

const isPortalHost = (host, env) => host === env.PORTAL_HOST || host.endsWith(".workers.dev") || host === "localhost" || host === "127.0.0.1";

async function signIn(env, code, onlySiteId, base) {
  const r = await redeemHandoff(env, code);
  if (!r || (onlySiteId && r.siteId !== onlySiteId))
    return page(messagePage("This link doesn’t work any more", "It may have expired or been used already. Open the editing page and sign in again."), 404, PRIVATE);
  return redirect(base || `/edit/${r.siteId}`, { "set-cookie": sessionCookie(r.siteId, r.token) });
}

async function editRoute(request, env, ctx, action) {
  let editor = await currentEditor(request, env, ctx.site.id);
  // A signed-in admin opening a site's editor on the portal gets in directly.
  const adminEmail = !editor && request.method === "GET" && isPortalHost(new URL(request.url).hostname, env) ? await currentAdmin(request, env) : null;
  if (adminEmail) {
    const token = await startSession(env, await ensureAdminEditor(env, ctx.site.id, adminEmail));
    return redirect(new URL(request.url).pathname, { "set-cookie": sessionCookie(ctx.site.id, token) });
  }
  if (!editor) {
    const name = JSON.parse(ctx.site.draft || ctx.site.config).name;
    return page(signInPage(name, googleReady(env) ? googleStartUrl(env, ctx.site.id, ctx.origin) : null), 401, PRIVATE);
  }
  const full = { ...ctx, editor };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...PRIVATE } });
  const asMessages = (rows) => rows.map((m) => ({ id: m.id, html: bubbleHtml(m) }));
  if (action === "assistant/messages" && request.method === "GET") {
    const after = Number(new URL(request.url).searchParams.get("after")) || 0;
    const site = await loadSite(env, ctx.site.id);
    return json({ messages: asMessages(await threadRows(env, ctx.site.id, after)), rev: site.draft_rev });
  }
  if (action === "assistant" && request.method === "POST") {
    const form = await formOf(request);
    const doc = await docText(form.get("doc"));
    if (doc.error) return json({ error: doc.error }, 400);
    const typed = String(form.get("request") || "").trim().slice(0, 20000); // room for pasted website copy
    const file = form.get("doc");
    const text = doc.text ? `${typed || "Build the website from this document."}\n\n[Attached document: ${String(file.name || "document").slice(0, 100)}]\n${doc.text}` : typed;
    if (!text) return json({ error: "Type what you’d like to change first." }, 400);
    const limited = await overLimit(env, ctx.site.id);
    if (limited) return json({ error: limited }, 429);
    const lastId = (await env.DB.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM agent_messages WHERE site_id = ?").bind(ctx.site.id).first()).id;
    let r;
    try { r = await assistantTurn(env, ctx.site.id, editor, text, JSON.parse(ctx.site.draft || ctx.site.config).name); }
    catch (e) { console.error("assistant failed", e?.status, e?.message); return json({ error: "The assistant isn’t available right now. Your message wasn’t sent — please try again in a few minutes." }, 503); }
    if (r.changed.length) await logActivity(env, ctx.site.id, editor.id, "assistant", r.changed.join(", "));
    return json({ messages: asMessages(await threadRows(env, ctx.site.id, lastId)), changed: r.changed, rev: r.rev });
  }
  const params = new URL(request.url).searchParams;
  if (request.method !== "POST") {
    if (action === "preview") {
      const site = await loadSite(env, ctx.site.id);
      const draft = JSON.parse(site.draft || site.config);
      const opts = { href: previewHref(`${ctx.base}/preview`) };
      const html = renderSite(draft, { ...opts, page: params.get("page") || "" }) || renderSite(draft, opts); // a page removed since: show home
      return page(html, 200, { ...PRIVATE, "content-security-policy": "frame-ancestors 'self'" });
    }
    return action ? notFound() : page(await editorView(env, full, { ...doneMessage(params.get("done"), ctx.site), page: params.get("page") || "", add: params.get("add") || "" }), 200, PRIVATE);
  }
  if (action === "signout") {
    await endSession(request, env, ctx.site.id);
    return redirect(ctx.base, { "set-cookie": clearCookie(ctx.site.id) });
  }
  const form = await formOf(request);
  const r = await editorPost(env, full, action || "", form);
  if (r === null) return notFound();
  r.page ??= String(form.get("page") || ""); // stay on the page being edited
  const pageQ = r.page ? `page=${encodeURIComponent(r.page)}` : "";
  if (r.done) return redirect(`${ctx.base}?done=${r.done}${pageQ ? `&${pageQ}` : ""}${r.add ? `&add=${r.add}` : ""}`);
  if (!r.flash && !r.errors && !r.notice) return redirect(`${ctx.base}${pageQ ? `?${pageQ}` : ""}`);
  const fresh = await loadSite(env, ctx.site.id); // show what's saved now, not the stale row
  return page(await editorView(env, { ...full, site: fresh }, r), r.errors ? 400 : 200, PRIVATE);
}

async function intake(request, env, code, origin) {
  const invite = await env.DB.prepare("SELECT site_id FROM invites WHERE code = ?").bind(code).first();
  if (!invite) return notFound();
  if (invite.site_id) {
    if (await currentEditor(request, env, invite.site_id)) return redirect(`/edit/${invite.site_id}`);
    return page(portalShell("Already set up", "<h1>This website has been set up</h1><p class=lead>Use your personal sign-in link to keep editing it. Lost it? Contact us and we’ll send a new one.</p>"));
  }
  if (request.method !== "POST") return page(intakeForm(code), 200, { "cache-control": "no-store" });
  const form = await formOf(request);
  const r = await handleIntakePost(env, code, form);
  if (r.notFound) return notFound();
  if (r.used) return redirect(`/start/${code}`);
  if (r.errors)
    return page(intakeForm(code, r.config, { domain: r.domain, errors: r.errors, submitter: { name: form.get("submitterName"), email: form.get("submitterEmail") } }), 400);
  const owner = await addEditor(env, { siteId: r.siteId, email: r.owner.email, name: r.owner.name, role: "owner" });
  if (owner.error) return page(messagePage("Something went wrong", esc(owner.error)), 400);
  const token = await startSession(env, owner.id);
  const fallback = googleReady(env) ? "" : `<p class="notice">Your sign-in link for next time (works for 7 days): <code>${esc(origin)}/signin/${await makeHandoff(env, owner.id, "link")}</code></p>`;
  return page(portalShell("Your website", `
<h1>Your preview is ready</h1>
<p class="lead">Nothing is public yet. On your editing page you can change anything, describe changes in plain words, and add teammates by email.</p>
<p class="lead">Next time, open <code>${esc(origin)}/edit/${r.siteId}</code> and sign in with Google as <strong>${esc(owner.email)}</strong>.</p>${fallback}
<p><a class="btn" href="/edit/${r.siteId}">Open my editing page</a></p>
<div class="notice"><strong>What happens next:</strong> we review the site, then contact you to connect your web address. If your domain has email (like you@yourgroup.org), we copy those settings across first so your email keeps working.</div>`),
    200, { ...PRIVATE, "set-cookie": sessionCookie(r.siteId, token) });
}

async function media(env, key) {
  if (!/^[0-9a-f]{16}\/[a-zA-Z]+-[0-9a-f]{8}\.(png|jpg|gif|webp)$/.test(key)) return new Response("Not found", { status: 404 });
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers({ "x-content-type-options": "nosniff", "content-security-policy": "sandbox" });
  obj.writeHttpMetadata(headers);
  return new Response(obj.body, { headers });
}

// Linked from the Google sign-in consent screen; keep it in step with what the code actually collects.
// OPERATOR_NAME / OPERATOR_EMAIL (wrangler vars) say who runs this deployment.
const privacy = (env) => `<h1>Privacy</h1>
<p class="lead">Website Kit hosts websites for community organizations.${env.OPERATOR_NAME ? ` It is run by ${esc(env.OPERATOR_NAME)}.` : ""}</p>
<h2>People who edit a website</h2>
<p>When you sign in with Google, Website Kit receives your name and email address from Google. It uses them only to check that you are on the list of people allowed to edit that website, and to show your name to your teammates next to your edits. It does not ask Google for anything else, such as your contacts, files or calendar.</p>
<p>Website Kit stores: the name and email address of each editor, a sign-in cookie so you stay signed in, the history of changes to each website, and the conversation with the website assistant.</p>
<p>Messages and documents you send to the website assistant, along with the website’s text and settings, are sent to Anthropic, which provides the AI that writes the replies. Photos and logos are not sent.</p>
<p>If you connect an AI app, such as Claude or ChatGPT, to Website Kit, that app can read and change the drafts of the websites you can edit, but not publish them. What the app does with that information is covered by its own provider’s privacy policy. Disconnect it in the app at any time; it also loses access as soon as you are removed from a website’s editors.</p>
<h2>People who visit a website</h2>
<p>Published websites set no cookies and use no tracking or advertising. Fonts are loaded from Google Fonts, so your browser contacts Google when a page loads.</p>
<h2>Where it lives, and who sees it</h2>
<p>Everything is stored with Cloudflare, which hosts the service. Nothing is sold or shared for advertising.</p>
<h2>Removing your information</h2>
<p>Ask the person who manages your organization’s website to remove you, ${env.OPERATOR_EMAIL ? `or email <a href="mailto:${esc(env.OPERATOR_EMAIL)}">${esc(env.OPERATOR_EMAIL)}</a> ` : ""}and your details will be deleted.</p>`;
