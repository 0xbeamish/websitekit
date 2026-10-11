import { esc } from "./html.js";
import { normalize } from "./schema.js";

// Messages visitors send through a site's message form. They're stored for the site's editors, who read them
// on /edit; nothing is emailed. Only the published site sends (previews render the form without an action).

export const DAILY_PER_SITE = 50; // messages a site accepts per day, so a flood can't fill the inbox
const SHOWN = 50; // newest messages listed in the editor
const EMAIL = /^[^\s@"'<>?&#%/\\]+@[^\s@"'<>?&#%/\\]+\.[^\s@"'<>?&#%/\\]+$/; // also safe to put in a mailto: link

const clip = (v, n) => String(v ?? "").trim().slice(0, n);

// A POST to /_kit/message on a live site. Returns null when the form it names isn't on the published site,
// else { slug, at } plus sent: true, or error and the values to show again.
export async function receiveMessage(env, site, form) {
  const cfg = normalize(JSON.parse(site.config));
  const slug = clip(form.get("page"), 40), at = clip(form.get("at"), 20);
  const current = slug ? cfg.pages.find((p) => p.slug === slug) : null;
  if (slug && !current) return null;
  const i = at.match(/^form-(\d{1,2})$/)?.[1];
  if (i === undefined || (current ? current.sections : cfg.sections)[Number(i)]?.type !== "form") return null;
  const back = { slug, at };
  if (clip(form.get("website"), 10)) return { ...back, sent: true }; // the hidden field only bots fill in: look sent, keep nothing
  const values = { name: clip(form.get("name"), 120), email: clip(form.get("email"), 200), message: clip(form.get("message"), 4000) };
  let error = !values.name || !values.email || !values.message ? "Please fill in your name, email address and message."
    : !EMAIL.test(values.email) ? "That email address doesn’t look right. Please check it." : "";
  if (!error) {
    const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM contact_messages WHERE site_id = ? AND created_at > datetime('now', '-1 day')").bind(site.id).first();
    if (today.n >= DAILY_PER_SITE) error = "This website has had a lot of messages today, so yours wasn’t sent. Please try again tomorrow.";
  }
  if (error) return { ...back, error, values };
  await env.DB.prepare("INSERT INTO contact_messages (site_id, page, name, email, message) VALUES (?, ?, ?, ?, ?)")
    .bind(site.id, current ? current.title : "", values.name, values.email, values.message).run();
  return { ...back, sent: true };
}

export const messageRows = (env, siteId) =>
  env.DB.prepare("SELECT id, page, name, email, message, read_at, created_at FROM contact_messages WHERE site_id = ? ORDER BY id DESC LIMIT ?").bind(siteId, SHOWN).all().then((r) => r.results)
    .catch((e) => { console.error("contact_messages", e?.message); return []; }); // the editor still opens before the table exists

// The editor's "Messages from your website" panel. `ago` formats a stored UTC time.
export function messagesPanel(rows, { base, siteName, ago }) {
  const unread = rows.filter((m) => !m.read_at).length;
  const subject = encodeURIComponent(`Your message to ${siteName || "us"}`);
  const items = rows.map((m) => `<li${m.read_at ? "" : ' class="new"'}><div><strong>${esc(m.name)}</strong> <span class="hint">· ${esc(ago(m.created_at))}${m.page ? ` · from the “${esc(m.page)}” page` : ""}${m.read_at ? "" : " · new"}</span></div>
    <div class="email">${esc(m.email)}</div><div class="text">${esc(m.message)}</div>
    <div class="msg-tools"><a class="btn small" href="mailto:${esc(m.email)}?subject=${subject}">Reply by email</a><form method="post" action="${base}/messages/${m.id}/delete" data-confirm="Delete this message from ${esc(m.name)}? It can’t be brought back."><button class="btn small danger">Delete</button></form></div></li>`).join("");
  return `<details class="group" id="g-messages"><summary>Messages from your website${unread ? `<span class="chip">${unread} new</span>` : ""}</summary><div class="group-body">
  <p class="hint">What visitors send with the message form on your published website. Everyone on your team sees them here. They aren’t emailed to you, so check back now and then.</p>
  ${rows.length ? `<ul class="inbox">${items}</ul>${unread ? `<form method="post" action="${base}/messages/read"><button class="btn small">Mark all as read</button></form>` : ""}${rows.length >= SHOWN ? `<p class="hint">Showing the newest ${SHOWN}. Delete the ones you’ve dealt with to see earlier ones.</p>` : ""}`
    : `<p class="hint">No messages yet.</p>`}</div></details>`;
}

// Editor actions: messages/read and messages/<id>/delete. Returns null for anything else.
export async function messagesPost(env, site, action) {
  if (action === "messages/read") {
    await env.DB.prepare("UPDATE contact_messages SET read_at = datetime('now') WHERE site_id = ? AND read_at IS NULL").bind(site.id).run();
    return { done: "messagesRead" };
  }
  const del = action.match(/^messages\/(\d{1,12})\/delete$/);
  if (!del) return null;
  await env.DB.prepare("DELETE FROM contact_messages WHERE id = ? AND site_id = ?").bind(Number(del[1]), site.id).run();
  return { done: "messageDeleted" };
}
