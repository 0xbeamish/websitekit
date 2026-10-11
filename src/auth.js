import { randomId } from "./portal.js";

// Editors are listed by email and sign in with Google. Google only redirects back to the portal, so the
// portal hands the browser to the site's own domain with a short-lived code (/signin/<code>), which becomes
// a session cookie there. Admin can also make a fallback link (a reusable code, 7 days).

const sha256 = async (s) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

const cookieName = (siteId) => `wk_${siteId}`;
export const normEmail = (e) => String(e || "").trim().toLowerCase().slice(0, 200);
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export function readCookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

export const sessionCookie = (siteId, token) => `${cookieName(siteId)}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000`;
export const clearCookie = (siteId) => `${cookieName(siteId)}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function currentEditor(request, env, siteId) {
  const token = readCookie(request, cookieName(siteId));
  if (!token || !/^[0-9a-f]{32}$/.test(token)) return null;
  return env.DB.prepare(
    "SELECT e.* FROM sessions s JOIN editors e ON e.id = s.editor_id WHERE s.token_hash = ? AND e.site_id = ? AND e.revoked_at IS NULL AND s.expires_at > datetime('now')"
  ).bind(await sha256(token), siteId).first();
}

export const isAdminEmail = (env, email) => String(env.ADMIN_EMAILS || "").split(",").map(normEmail).filter(Boolean).includes(normEmail(email));

// An admin gets an owner-level row on any site they open, marked so the org can't remove it.
export async function ensureAdminEditor(env, siteId, email) {
  const e = normEmail(email);
  const row = await env.DB.prepare("SELECT id FROM editors WHERE site_id = ? AND email = ? AND revoked_at IS NULL").bind(siteId, e).first();
  if (row) {
    await env.DB.prepare("UPDATE editors SET role = 'owner', is_admin = 1 WHERE id = ?").bind(row.id).run();
    return row.id;
  }
  const id = randomId(8);
  await env.DB.prepare("INSERT INTO editors (id, site_id, name, email, role, is_admin) VALUES (?, ?, 'Website Kit admin', ?, 'owner', 1)").bind(id, siteId, e).run();
  return id;
}

export async function currentAdmin(request, env) {
  const token = readCookie(request, "wk_admin");
  if (!token || !/^[0-9a-f]{32}$/.test(token)) return null;
  const row = await env.DB.prepare("SELECT email FROM admin_sessions WHERE token_hash = ? AND expires_at > datetime('now')").bind(await sha256(token)).first();
  return row && isAdminEmail(env, row.email) ? row.email : null; // dropping someone from ADMIN_EMAILS ends their access at once
}
export const adminCookie = (token) => `wk_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;

export async function startSession(env, editorId) {
  const token = randomId(16);
  await env.DB.prepare("INSERT INTO sessions (token_hash, editor_id, expires_at) VALUES (?, ?, datetime('now', '+90 days'))").bind(await sha256(token), editorId).run();
  return token;
}

export async function endSession(request, env, siteId) {
  const token = readCookie(request, cookieName(siteId));
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

export async function makeHandoff(env, editorId, kind) {
  const code = randomId(16);
  const ttl = kind === "google" ? "+5 minutes" : "+7 days";
  await env.DB.prepare("INSERT INTO handoffs (code_hash, editor_id, kind, expires_at) VALUES (?, ?, ?, datetime('now', ?))").bind(await sha256(code), editorId, kind, ttl).run();
  return code;
}

// Turns a handoff code into a session. Google codes work once; admin links keep working until they expire,
// so an email scanner opening the link first doesn't burn it.
export async function redeemHandoff(env, code) {
  if (!/^[0-9a-f]{32}$/.test(code)) return null;
  const hash = await sha256(code);
  const h = await env.DB.prepare(
    "SELECT h.kind, e.id, e.site_id FROM handoffs h JOIN editors e ON e.id = h.editor_id JOIN sites s ON s.id = e.site_id WHERE h.code_hash = ? AND h.expires_at > datetime('now') AND e.revoked_at IS NULL AND s.status != 'archived'"
  ).bind(hash).first();
  if (!h) return null;
  if (h.kind === "google") await env.DB.prepare("DELETE FROM handoffs WHERE code_hash = ?").bind(hash).run();
  return { editorId: h.id, siteId: h.site_id, token: await startSession(env, h.id) };
}

export async function addEditor(env, { siteId, email, name = "", role = "editor", createdBy = null }) {
  const e = normEmail(email);
  if (!validEmail(e)) return { error: "That email address doesn’t look right." };
  const existing = await env.DB.prepare("SELECT id FROM editors WHERE site_id = ? AND email = ? AND revoked_at IS NULL").bind(siteId, e).first();
  if (existing) return { error: `${e} can already edit this site.` };
  const id = randomId(8);
  await env.DB.prepare("INSERT INTO editors (id, site_id, name, email, role, created_by) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, siteId, String(name || "").trim().slice(0, 120), e, role, createdBy).run();
  return { id, email: e };
}

// ---- Google sign-in (OpenID Connect, authorization-code flow). Runs only on the portal host. ----

export const googleReady = (env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.PORTAL_HOST);
export const portalOrigin = (env) => env.PORTAL_ORIGIN || `https://${env.PORTAL_HOST}`; // PORTAL_ORIGIN: local dev only (http://127.0.0.1:8787)
const callbackUrl = (env) => `${portalOrigin(env)}/auth/google/callback`;

// Where the "Sign in with Google" button points, from any host.
export const googleStartUrl = (env, siteId, returnOrigin) =>
  `${portalOrigin(env)}/auth/google?site=${siteId}&return=${encodeURIComponent(returnOrigin)}`;

export async function googleStart(env, url) {
  const siteId = url.searchParams.get("site") || "";
  const ret = url.searchParams.get("return") || "";
  if (siteId === "admin") {
    if (ret !== portalOrigin(env)) return null;
  } else {
    const site = /^[0-9a-f]{16}$/.test(siteId) ? await env.DB.prepare("SELECT id, status, domain FROM sites WHERE id = ? AND status != 'archived'").bind(siteId).first() : null;
    if (!site) return null;
    const allowed = [portalOrigin(env), site.status === "live" && site.domain ? `https://${site.domain}` : null];
    if (!allowed.includes(ret)) return null; // never send a sign-in to an origin this site doesn't own
  }
  const state = randomId(16);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_states WHERE created_at < datetime('now', '-1 hour')"),
    env.DB.prepare("INSERT INTO login_states (state, site_id, return_origin) VALUES (?, ?, ?)").bind(state, siteId, ret),
  ]);
  return googleAuthUrl(env, state);
}

// Google's sign-in page; it sends the browser back to the one registered callback with this state.
export const googleAuthUrl = (env, state) =>
  `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: callbackUrl(env), response_type: "code", scope: "openid email profile", state, prompt: "select_account" })}`;

// Google's code → { email, name } for a verified address, or { error }.
export async function googleIdentity(env, code) {
  if (!code) return { error: "Sign-in was cancelled." };
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: callbackUrl(env), grant_type: "authorization_code" }),
  });
  if (!res.ok) { console.error("google token exchange", res.status, await res.text()); return { error: "Google sign-in didn’t work. Please try again." }; }
  const { id_token } = await res.json();
  // Received straight from Google's token endpoint over TLS, so the claims can be read without checking the signature (OIDC Core 3.1.3.7).
  let claims;
  try { claims = JSON.parse(atob(id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return { error: "Google sign-in didn’t work. Please try again." }; }
  if (claims.aud !== env.GOOGLE_CLIENT_ID || !["https://accounts.google.com", "accounts.google.com"].includes(claims.iss) || !claims.email_verified)
    return { error: "Google couldn’t confirm that email address." };
  return { email: normEmail(claims.email), name: claims.name ? String(claims.name).slice(0, 120) : "" };
}

// Returns { redirect } on success or { error } with a message for the person.
export async function googleCallback(env, url) {
  const state = url.searchParams.get("state") || "";
  const login = await env.DB.prepare("SELECT * FROM login_states WHERE state = ? AND created_at > datetime('now', '-10 minutes')").bind(state).first();
  if (!login) return { error: "That sign-in took too long or was already used. Please try again." };
  await env.DB.prepare("DELETE FROM login_states WHERE state = ?").bind(state).run();
  const who = await googleIdentity(env, url.searchParams.get("code"));
  if (who.error) return { error: who.error };
  const { email } = who;
  if (login.site_id === "admin") {
    if (!isAdminEmail(env, email)) return { error: `${email} isn’t a Website Kit admin.`, retry: googleStartUrl(env, "admin", portalOrigin(env)) };
    const token = randomId(16);
    await env.DB.prepare("INSERT INTO admin_sessions (token_hash, email, expires_at) VALUES (?, ?, datetime('now', '+30 days'))").bind(await sha256(token), email).run();
    return { redirect: `${portalOrigin(env)}/admin`, cookie: adminCookie(token) };
  }
  if (isAdminEmail(env, email)) await ensureAdminEditor(env, login.site_id, email);
  const editor = await env.DB.prepare("SELECT id FROM editors WHERE site_id = ? AND email = ? AND revoked_at IS NULL").bind(login.site_id, email).first();
  if (!editor) return { error: `${email} isn’t on the list of people who can edit this website. Ask whoever manages it to add you, then try again.`, retry: googleStartUrl(env, login.site_id, login.return_origin) };
  if (who.name) await env.DB.prepare("UPDATE editors SET name = ? WHERE id = ? AND (name IS NULL OR name = '')").bind(who.name, editor.id).run();
  return { redirect: `${login.return_origin}/signin/${await makeHandoff(env, editor.id, "google")}` };
}
