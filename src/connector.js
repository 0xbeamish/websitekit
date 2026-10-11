import { OAuthProvider, AuthorizationError, CimdFetchError, authorizationErrorRedirect, insufficientScope } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { esc } from "./html.js";
import { normalize } from "./schema.js";
import { templateGuide, forModel, withMedia, describeChanges } from "./ai.js";
import { googleAuthUrl, googleIdentity, isAdminEmail, ensureAdminEditor, portalOrigin } from "./auth.js";
import { messagePage, logActivity } from "./editor.js";
import { saveRequest } from "./requests.js";

// Lets outside agents (Claude, ChatGPT, anything that speaks MCP) read sites and change drafts for the
// person who connects them. Sign-in is OAuth: this worker is the authorization server, Google proves who
// the person is, and they reach the same sites they can open at /edit. Agents never publish.

const SCOPE = "sites:edit";

let provider;
// Built on first use: the resource URL comes from env. Only the portal host is wrapped (see index.js).
export const connector = (env, app) => (provider ??= new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: { fetch: mcp },
  defaultHandler: app,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: [SCOPE],
  requiredScopes: [SCOPE],
  resourceMetadata: { resource: `${portalOrigin(env)}/mcp`, authorization_servers: [portalOrigin(env)], resource_name: "Website Kit" },
  accessTokenTTL: 3600,
}));

// ---------- signing in: consent here, identity from Google ----------

const page = (html, status = 200, headers = new Headers()) => {
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(html, { status, headers });
};
const failed = (text) => page(messagePage("Couldn’t connect", esc(text)), 400);

function consentPage(d, handle) {
  const who = d.clientDomain ? `<strong>${esc(d.clientName)}</strong> <span class="hint">(${esc(d.clientDomain)})</span>` : `<strong>${esc(d.clientName)}</strong>`;
  return messagePage("Connect an AI assistant", `${who} wants to work on your Website Kit websites.</p>
<p>It will be able to read the sites you can edit and <strong>change their drafts</strong>. It can’t publish — you still check the preview and press Publish yourself.</p>
<p class="hint">${d.clientDomain ? "" : "This app named itself; Website Kit can’t verify the name. "}Access goes to <strong>${esc(d.redirectHost)}</strong>.${d.redirectIsLoopback ? " That’s a program on this computer — continue only if you just started connecting from it." : ""}</p>
<form method="post"><input type="hidden" name="handle" value="${esc(handle)}">
<button class="btn g" name="decision" value="approve">Continue with Google</button>
<button class="btn quiet g" name="decision" value="deny">Cancel</button></form>
<p class="hint">Sign in with the Google account you use to edit your website.`);
}

// GET shows consent; POST (Allow) hands the browser to Google with state the library binds to it.
export async function authorize(request, env) {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === "GET") {
      const req = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(req);
      const consent = await oauth.beginConsent(req);
      return page(consentPage(details, consent.handle), 200, consent.headers);
    }
    const form = await request.formData();
    const handle = String(form.get("handle") || "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(request, handle, { scope: [SCOPE] });
    const client = await oauth.lookupClient(approved.request.clientId);
    const { state, headers } = await oauth.beginUpstream(approved.request, { data: { client: client?.clientName || "An AI assistant" }, headers: approved.headers });
    headers.set("location", googleAuthUrl(env, state));
    return new Response(null, { status: 302, headers });
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError) return failed(`${e.description || "This sign-in link isn’t valid."} Start connecting again from your AI app.`);
    if (e instanceof CimdFetchError) return failed("That app couldn’t be verified. Start connecting again from your AI app.");
    throw e;
  }
}

// Google sends the browser back to /auth/google/callback; index.js passes states it didn't issue to here.
export async function finishSignIn(request, env) {
  const oauth = env.OAUTH_PROVIDER;
  let resumed;
  try { resumed = await oauth.finishUpstream(request); }
  catch (e) { if (e instanceof AuthorizationError) return failed("That sign-in expired or was opened in a different browser. Start connecting again from your AI app."); throw e; }
  const { request: original, data, headers } = resumed;
  const back = (error) => { headers.set("location", authorizationErrorRedirect(original, error)); return new Response(null, { status: 302, headers }); };
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return back("access_denied");
  const who = await googleIdentity(env, url.searchParams.get("code"));
  if (who.error) return failed(who.error);
  if (!(await sitesFor(env, who.email)).length)
    return failed(`${who.email} isn’t on the list of people who can edit any Website Kit site. Ask whoever manages your website to add you, then connect again.`);
  const { redirectTo } = await oauth.completeAuthorization({
    request: original, userId: who.email, metadata: { client: data.client }, scope: original.scope,
    props: { email: who.email, client: String(data.client).slice(0, 80) },
  });
  headers.set("location", redirectTo);
  return new Response(null, { status: 302, headers });
}

// ---------- what a connected agent can do ----------

// Sites this person can edit now: checked on every call, so removing someone at /edit ends their agent's access too.
async function sitesFor(env, email) {
  const q = isAdminEmail(env, email)
    ? env.DB.prepare("SELECT id, domain, status, config, draft, draft_rev, updated_at FROM sites WHERE status != 'archived' ORDER BY updated_at DESC")
    : env.DB.prepare("SELECT s.id, s.domain, s.status, s.config, s.draft, s.draft_rev, s.updated_at FROM sites s JOIN editors e ON e.site_id = s.id WHERE e.email = ? AND e.revoked_at IS NULL AND s.status != 'archived' ORDER BY s.updated_at DESC").bind(email);
  return (await q.all()).results;
}

const editorUrl = (env, s) => (s.status === "live" && s.domain ? `https://${s.domain}/edit` : `${portalOrigin(env)}/edit/${s.id}`);
const draftOf = (s) => JSON.parse(s.draft || s.config);
const reply = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (text) => ({ content: [{ type: "text", text }], isError: true });

const INSTRUCTIONS = `Website Kit hosts websites for community organizations. Each site is a JSON settings file rendered by a fixed template; you edit the site's private draft, and a person reviews the preview and publishes it in the editor. You cannot publish.

${templateGuide()}

How to work:
- Call list_sites, then get_site before changing anything. save_site replaces the whole draft: send every part, copying what you aren't changing exactly as get_site returned it, with the rev it returned.
- If save_site reports a conflict, someone else saved first: call get_site again and redo your change on top of theirs.
- Never invent facts — no made-up numbers, quotes, names, dates, addresses, phone numbers or links. Ask the person instead.
- When given website copy, use its wording as written. Notes about the website (like "I'll add a form here") are instructions, not text to publish.
- Photos and logos are uploaded in the editor; they stay attached when you save.
- After saving, tell the person what changed and give them the editor link so they can check the preview and press Publish.
- If they want something the template can't do, say so, suggest what's possible now, and offer to pass it on with suggest_feature (only once they agree).`;

export function server(env, props) { // exported for tests
  const s = new McpServer({ name: "Website Kit", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  s.registerTool("list_sites", {
    title: "List websites",
    description: "The websites you can edit, with their pages and whether the draft has unpublished changes.",
    inputSchema: {}, annotations: { readOnlyHint: true },
  }, async () => {
    const sites = await sitesFor(env, props.email);
    return reply(sites.map((x) => {
      const d = normalize(draftOf(x));
      return {
        site_id: x.id, name: d.name, address: x.domain ? `https://${x.domain}` : null, live: x.status === "live",
        pages: ["Home", ...d.pages.map((p) => `${p.title} (/${p.slug})`)], unpublished_changes: (x.draft || x.config) !== x.config, editor: editorUrl(env, x),
      };
    }));
  });

  s.registerTool("get_site", {
    title: "Read a website",
    description: "The draft settings of one website (home sections, extra pages, theme, colours), plus the rev to send back with save_site.",
    inputSchema: { site_id: z.string().describe("From list_sites") }, annotations: { readOnlyHint: true },
  }, async ({ site_id }) => {
    const x = (await sitesFor(env, props.email)).find((r) => r.id === site_id);
    if (!x) return fail("No website with that site_id that you can edit. Call list_sites.");
    return reply({ site_id: x.id, rev: x.draft_rev, editor: editorUrl(env, x), site: forModel(normalize(draftOf(x))) });
  });

  s.registerTool("save_site", {
    title: "Save a website draft",
    description: "Replace one website's draft with complete updated settings (same shape get_site returned). Doesn't publish: a person checks the preview in the editor and publishes. Returns what changed.",
    inputSchema: {
      site_id: z.string(),
      rev: z.number().int().describe("The rev from your latest get_site"),
      site: z.object({}).passthrough().describe("The whole site: name, theme, colors, sections (home) and pages, as get_site returned them with your changes"),
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  }, async ({ site_id, rev, site }) => {
    const x = (await sitesFor(env, props.email)).find((r) => r.id === site_id);
    if (!x) return fail("No website with that site_id that you can edit. Call list_sites.");
    const current = normalize(draftOf(x));
    const next = withMedia(current, site);
    const parts = describeChanges(current, next);
    if (!parts.length) return reply("Nothing changed — those settings match the draft.");
    const r = await env.DB.prepare("UPDATE sites SET draft = ?, draft_rev = draft_rev + 1, updated_at = datetime('now') WHERE id = ? AND draft_rev = ?")
      .bind(JSON.stringify(next), site_id, rev).run();
    if (r.meta.changes !== 1) return fail("Conflict: the draft changed since your get_site (someone else saved). Call get_site again and redo your change on top of theirs.");
    const editor = isAdminEmail(env, props.email)
      ? await ensureAdminEditor(env, site_id, props.email)
      : (await env.DB.prepare("SELECT id FROM editors WHERE site_id = ? AND email = ? AND revoked_at IS NULL").bind(site_id, props.email).first())?.id;
    await logActivity(env, site_id, editor, "agent", `${props.client}: ${parts.join(", ")}`);
    return reply({ saved: true, rev: rev + 1, changed: parts, next_step: `Ask the person to check the preview and press Publish at ${editorUrl(env, x)}` });
  });

  s.registerTool("suggest_feature", {
    title: "Suggest a new feature",
    description: "Pass a request for something the website can't do yet to the people who build Website Kit. Only after the person agrees. No names, emails or other personal details.",
    inputSchema: { site_id: z.string(), title: z.string().describe("A few plain words"), details: z.string().describe("What they want, what it's for, how they'd expect it to work") },
  }, async ({ site_id, title, details }) => {
    if (!(await sitesFor(env, props.email)).some((r) => r.id === site_id)) return fail("No website with that site_id that you can edit. Call list_sites.");
    const editor = await env.DB.prepare("SELECT id FROM editors WHERE site_id = ? AND email = ? AND revoked_at IS NULL").bind(site_id, props.email).first();
    return reply(await saveRequest(env, { siteId: site_id, editorId: editor?.id, via: props.client, title, details }));
  });

  return s;
}

async function mcp(request, env, ctx) {
  if (!ctx.auth.scope.includes(SCOPE)) return insufficientScope(ctx.auth, [SCOPE]);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true }); // stateless: every request stands alone
  await server(env, ctx.props).connect(transport);
  return transport.handleRequest(request);
}
