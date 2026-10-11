import { esc, portalShell } from "./html.js";
import { randomId, normalizeDomain } from "./portal.js";
import { publish } from "./editor.js";
import { addEditor, makeHandoff, normEmail } from "./auth.js";

// Basic auth against the ADMIN_PASSWORD secret; username is ignored.
export function isAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const h = request.headers.get("authorization") || "";
  if (!h.startsWith("Basic ")) return false;
  let pass = "";
  try { pass = atob(h.slice(6)).split(":").slice(1).join(":"); } catch { return false; }
  const a = new TextEncoder().encode(pass), b = new TextEncoder().encode(env.ADMIN_PASSWORD);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]; // constant-time compare
  return diff === 0;
}

export const challenge = () =>
  new Response("Admin login required", { status: 401, headers: { "www-authenticate": 'Basic realm="websitekit admin"' } });

export async function adminView(env, origin, flash = "") {
  const [{ results: sites }, { results: invites }, { results: owners }] = await Promise.all([
    env.DB.prepare("SELECT id, slug, status, domain, COALESCE(draft, config) AS config, submitter_name, submitter_email, updated_at FROM sites ORDER BY status = 'pending' DESC, updated_at DESC").all(),
    env.DB.prepare("SELECT code, label, created_at, site_id FROM invites ORDER BY created_at DESC LIMIT 50").all(),
    env.DB.prepare("SELECT site_id, email FROM editors WHERE role = 'owner' AND revoked_at IS NULL").all(),
  ]);
  const ownerOf = Object.fromEntries(owners.map((o) => [o.site_id, o.email]));
  const siteRows = sites.map((s) => {
    const name = JSON.parse(s.config).name;
    const open = s.status !== "archived";
    return `<article class="site">
<div class="site-head"><div><h3>${esc(name)}</h3><span class="pill ${s.status}">${s.status}</span>
 <a href="/preview/${s.id}">Preview draft</a> · <a href="/edit/${s.id}">Editor</a>${s.domain && s.status === "live" ? ` · <a href="https://${esc(s.domain)}">${esc(s.domain)}</a>` : ""}</div>
 ${s.status === "pending" ? `<form method="post" action="/admin/sites/${s.id}/approve"><button class="btn publish">Approve and publish</button></form>` : ""}</div>
${open ? `<div class="site-forms">
 <form class="inline" method="post" action="/admin/sites/${s.id}/domain"><label for="d-${s.id}">Domain</label><input id="d-${s.id}" type="text" name="domain" value="${esc(s.domain || "")}" placeholder="example.org"><button class="btn small">Save</button></form>
 <form class="inline" method="post" action="/admin/sites/${s.id}/owner"><label for="o-${s.id}">Owner</label><input id="o-${s.id}" type="email" name="email" value="${esc(ownerOf[s.id] || "")}" placeholder="owner@example.org" required><button class="btn small">Set</button></form>
</div>
<div class="site-actions"><form method="post" action="/admin/sites/${s.id}/owner-link"><button class="btn quiet">Make an owner sign-in link</button></form>
 <form method="post" action="/admin/sites/${s.id}/archive" data-confirm="Archive ${esc(name)}? It stops answering on its domain."><button class="btn quiet danger">Archive</button></form></div>` : ""}
${s.submitter_email ? `<p class="hint">Submitted by ${esc(s.submitter_name || "")} ${esc(s.submitter_email)}</p>` : ""}
</article>`;
  }).join("");
  const inviteRows = invites.map((i) => `<li><span><strong>${esc(i.label)}</strong> <span class="hint">· ${i.site_id ? "used" : "not used yet"}</span></span><code>${esc(origin)}/start/${esc(i.code)}</code></li>`).join("");
  return portalShell("Website Kit admin", `
<h1>Website Kit admin</h1>
${flash ? `<div class="msg" role="status">${flash}</div>` : ""}
<h2>Sites</h2>
${sites.length ? siteRows : "<p class=lead>No sites yet. Create an invite below and send it to an organization.</p>"}
<h2>Invite an organization</h2>
<form class="inline" method="post" action="/admin/invites"><label for="label">Who is it for?</label><input id="label" name="label" type="text" placeholder="e.g. Jane at Riverside Tenants" required><button class="btn save">Create invite link</button></form>
${invites.length ? `<ul class="invites">${inviteRows}</ul>` : ""}
<h2>Going live checklist</h2>
<p class="lead">Approving makes the site answer on its domain, but the domain still has to be connected by hand: add the domain in Cloudflare, copy every email record (MX, SPF, DKIM, DMARC) first, attach the domain and <code>www</code> to the <code>websitekit</code> Worker, then switch nameservers at the registrar.</p>`);
}

export async function adminPost(env, url, form) {
  const m = url.pathname.match(/^\/admin\/sites\/([0-9a-f]+)\/(approve|archive|domain|owner|owner-link)$/);
  if (url.pathname === "/admin/invites") {
    const code = randomId(10);
    await env.DB.prepare("INSERT INTO invites (code, label) VALUES (?, ?)").bind(code, String(form.get("label") || "").slice(0, 200)).run();
    return `Invite created: <code>${esc(url.origin)}/start/${code}</code>`;
  }
  if (!m) return null;
  const [, id, action] = m;
  if (action === "approve") {
    const r = await env.DB.prepare("UPDATE sites SET status = 'live', approved_at = datetime('now') WHERE id = ? AND status = 'pending'").bind(id).run();
    if (r.meta.changes) await publish(env, id);
    return "Approved. Connect the domain in Cloudflare to finish.";
  }
  if (action === "owner") {
    const email = normEmail(form.get("email"));
    const owner = await env.DB.prepare("SELECT id FROM editors WHERE site_id = ? AND role = 'owner' AND revoked_at IS NULL").bind(id).first();
    const taken = await env.DB.prepare("SELECT id FROM editors WHERE site_id = ? AND email = ? AND revoked_at IS NULL").bind(id, email).first();
    if (taken && taken.id !== owner?.id) { // already an editor: promote them
      await env.DB.batch([
        env.DB.prepare("UPDATE editors SET role = 'editor' WHERE site_id = ? AND role = 'owner'").bind(id),
        env.DB.prepare("UPDATE editors SET role = 'owner' WHERE id = ?").bind(taken.id),
      ]);
      return `${esc(email)} is now the owner.`;
    }
    if (owner) {
      const r = await env.DB.prepare("UPDATE editors SET email = ? WHERE id = ?").bind(email, owner.id).run().catch(() => null);
      return r ? `Owner email set to ${esc(email)}. They sign in with Google at the site’s /edit page.` : "That email isn’t valid.";
    }
    const r = await addEditor(env, { siteId: id, email, role: "owner" });
    return r.error ? esc(r.error) : `${esc(email)} is now the owner. They sign in with Google at the site’s /edit page.`;
  }
  if (action === "owner-link") {
    const site = await env.DB.prepare("SELECT status, domain FROM sites WHERE id = ?").bind(id).first();
    const owner = await env.DB.prepare("SELECT id FROM editors WHERE site_id = ? AND role = 'owner' AND revoked_at IS NULL").bind(id).first();
    if (!site || !owner) return "Set an owner email first.";
    const origin = site.status === "live" && site.domain ? `https://${site.domain}` : url.origin; // sign in where they'll edit: cookies are per-domain
    return `Owner sign-in link, works for 7 days (a fallback for when Google sign-in isn’t available): <code>${esc(origin)}/signin/${await makeHandoff(env, owner.id, "link")}</code>`;
  }
  if (action === "archive") {
    await env.DB.prepare("UPDATE sites SET status = 'archived' WHERE id = ?").bind(id).run();
    return "Archived — it no longer answers on its domain.";
  }
  const raw = String(form.get("domain") || "");
  const domain = raw.trim() ? normalizeDomain(raw) : null;
  if (raw.trim() && !domain) return `“${esc(raw)}” isn’t a valid domain.`;
  try {
    await env.DB.prepare("UPDATE sites SET domain = ?, updated_at = datetime('now') WHERE id = ?").bind(domain, id).run();
  } catch {
    return `${esc(domain)} is already used by another site.`;
  }
  return "Domain saved.";
}
