import Anthropic from "@anthropic-ai/sdk";
import { saveRequest } from "./requests.js";
import { normalize, section, PRESETS, FONT_PAIRS, RADII, RHYTHMS, MAX_PAGES } from "./schema.js";

// The site assistant: one shared conversation per site, which reads and edits the draft through two tools
// scoped to that site. It never publishes; a person does.

const MODEL = "claude-opus-5-5";
export const PER_SITE_DAILY = 100; // assistant requests per site per day
const ALL_SITES_DAILY = 200; // across all sites; bounds total spend
const MAX_STEPS = 6; // model calls per request
const HISTORY = 24; // past messages the assistant sees

const str = { type: "string" };
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const items = (props) => ({ type: "array", items: obj(props) });

// Mirrors schema.js minus images: the assistant never sees or writes media paths; they're re-attached after.
const SECTION_SCHEMAS = [
  obj({ type: { const: "hero" }, heading: str, body: str, buttons: { type: ["boolean", "null"] } }),
  obj({ type: { const: "text" }, kicker: str, heading: str, body: str }),
  obj({ type: { const: "cards" }, kicker: str, heading: str, intro: str, items: items({ title: str, body: str }) }),
  obj({ type: { const: "stats" }, heading: str, items: items({ value: str, label: str }) }),
  obj({ type: { const: "quote" }, text: str, by: str }),
  obj({ type: { const: "faq" }, heading: str, items: items({ q: str, a: str }) }),
  obj({ type: { const: "cta" }, heading: str, body: str, button: str, link: str }),
  obj({ type: { const: "contact" }, heading: str, body: str, email: str, phone: str, location: str }),
  obj({ type: { const: "form" }, heading: str, body: str, button: str, thanks: str }),
];

const SECTIONS_SCHEMA = { type: "array", items: { anyOf: SECTION_SCHEMAS } };
export const SITE_SCHEMA = obj({
  name: str,
  theme: obj({
    preset: { type: "string", enum: Object.keys(PRESETS) },
    fonts: { type: "string", enum: ["", ...Object.keys(FONT_PAIRS)] },
    radius: { type: "string", enum: ["", ...Object.keys(RADII)] },
    rhythm: { type: "string", enum: ["", ...Object.keys(RHYTHMS)] },
  }),
  colors: obj({ primary: str, accent: str, background: str, header: str, footer: str }),
  sections: SECTIONS_SCHEMA,
  pages: { type: "array", items: obj({ title: str, slug: str, rhythm: { type: "string", enum: ["", ...Object.keys(RHYTHMS)] }, sections: SECTIONS_SCHEMA }) },
});

const TOOLS = [
  { name: "get_draft", description: "Read the site's current draft settings. Call this before changing anything, and again if a save reports a conflict.", strict: true,
    input_schema: { type: "object", properties: {}, additionalProperties: false } },
  // Not strict: with pages the schema is past strict mode's grammar limit; normalize() still cleans every save.
  { name: "save_draft", description: "Replace the draft with complete, updated settings, including every page. Copy every part you are not changing exactly as get_draft returned it. Returns which parts of the site changed.",
    input_schema: obj({ site: SITE_SCHEMA }) },
  { name: "suggest_feature", description: "Pass a request for something the website can't do yet to the people who build Website Kit. Only after the person agrees to pass it on.", strict: true,
    input_schema: obj({ title: { type: "string", description: "A few plain words, like \"Contact form on a page\"" }, details: { type: "string", description: "What they want, what it's for, and how they'd expect it to work, in plain words. No names, emails or other personal details." } }) },
];

// What the template can do, shared by the built-in assistant and the connector for outside agents (src/connector.js).
export const templateGuide = () => `What the template can do:
- theme.preset, the overall look: ${Object.entries(PRESETS).map(([k, v]) => `"${k}" (${v.blurb})`).join(" ")}
- theme.fonts / radius / rhythm override the preset; "" means use the preset's choice. fonts: ${Object.entries(FONT_PAIRS).map(([k, v]) => `"${k}" (${v.label})`).join(", ")}. radius: ${Object.keys(RADII).join(", ")}. rhythm (space between sections): ${Object.keys(RHYTHMS).join(", ")}.
- colors: primary, accent, background, each a 6-digit hex colour like #17324d; header and footer are optional colours for the top bar (name and menu) and the bottom strip, "" to use the background. Text and buttons adjust automatically to stay readable.
- sections: the home page, rendered top to bottom (at most 20). Types: hero (headline and intro; exactly one, first; buttons: true or false shows or hides its "Learn more" and "Get in touch" buttons, null leaves the default — shown on home, hidden on other pages), text (paragraphs separated by a blank line; for long copy), cards (up to 6 short items, each a title and a paragraph), stats (up to 4 figures), quote, faq (up to 8), cta (a banner with one button; link must be https://… or an email address), contact (email, phone, location), form (a message form where visitors type their name, email address and message; heading is required, body is a line above it, button and thanks are the button text and the thank-you line, "" for the defaults "Send message" and "Thanks — your message has been sent."; messages are kept on the editing page under "Messages from your website", not emailed, and the form only sends on the published site). Empty sections are hidden. Use "" for empty fields.
- pages: extra pages besides home, at most ${MAX_PAGES}, in menu order. Each has a title (the menu tab, short), a rhythm ("" for the site's spacing, or one of the rhythm values for that page only), a slug (its web address: lowercase letters, numbers and dashes, e.g. "about" for /about; keep an existing page's slug unless asked to change it) and its own sections, starting with a hero whose heading is usually the page title. With no pages the menu scrolls down the home page; with pages the menu shows Home plus each page. A home page that links on to other pages can be short: a hero, maybe a short intro.`;

const system = (siteName) => `You are the website assistant for ${siteName || "a community organization"}. Volunteers from the organization talk to you in one shared conversation; each message starts with the sender's name. The website is a JSON settings file rendered by a fixed template. You change the private draft with your tools; people review the preview and publish it themselves — you cannot publish.

${templateGuide()}

How to work:
- Read the draft with get_draft, then save the complete updated settings with save_draft. Change only what was asked.
- Never invent facts: no made-up numbers, quotes, names, dates, addresses, phone numbers or links. If you need a fact, ask for it instead of guessing, and don't save until you have it.
- If a request is unclear or could mean very different things, ask one short question first.
- Photos and the logo are uploaded through the editor's form; you can't change them, but they stay attached.
- If someone shares a document of website copy, build the site from it: one page per part it lists (the first or "Home" part goes in sections), using their wording word for word — split long text into paragraphs, but don't rewrite, shorten or add to it. Parts that hold notes about the website rather than copy (like "I'll add a form here" or "leave this blank for now") are instructions: follow them where the template can, and tell them which ones it can't do. Don't stop to ask about the copy; save the whole site in one go, then sum up.
- If something is beyond the template (custom code, new kinds of sections, galleries, payments, sign-up forms or forms with other fields than the message form, emailing messages, file downloads), say so, suggest what is possible now, and offer to pass the request on to the people who build Website Kit. Call suggest_feature only once they say yes; don't promise it will be built.
- Reply in plain, warm language, two or three short sentences, no markdown. After saving, say what changed and remind them to check the preview and press Publish when they're happy.
- Keep the organization's spelling (for example Canadian "Centre", "colour").`;

// Strip media fields so the model only sees what it may edit.
const noMedia = (sections) => sections.map(({ image, imageAlt, ...rest }) => rest);
export const forModel = (cfg) => ({
  name: cfg.name, theme: cfg.theme, colors: cfg.colors, sections: noMedia(cfg.sections),
  pages: cfg.pages.map((p) => ({ ...p, sections: noMedia(p.sections) })),
});

// Put the logo and hero photos back onto settings the model wrote (a page's photo follows its slug).
export const withMedia = (current, site) => {
  const next = normalize({ ...site, logo: current.logo });
  const keepHero = (from, to) => {
    const prevHero = from && section(from, "hero"), hero = to && section(to, "hero");
    if (hero && prevHero) Object.assign(hero, { image: prevHero.image, imageAlt: prevHero.imageAlt });
  };
  keepHero(current, next);
  for (const p of next.pages) keepHero(current.pages.find((x) => x.slug === p.slug), p);
  return normalize(next);
};

// Which parts of the page differ, in the editor's own words. Used for the activity log and tool results.
const PART = { hero: "Top of the page", text: "About", cards: "What you do", stats: "Numbers", quote: "Quote", faq: "Questions", cta: "Banner", contact: "Contact", form: "Message form" };
export function describeChanges(before, after) {
  const a = normalize(before), b = normalize(after), out = [];
  if (a.name !== b.name || a.logo !== b.logo) out.push("Name and logo");
  if (JSON.stringify([a.theme, a.colors]) !== JSON.stringify([b.theme, b.colors])) out.push("Style and colours");
  for (const [type, label] of Object.entries(PART))
    if (JSON.stringify(a.sections.filter((s) => s.type === type)) !== JSON.stringify(b.sections.filter((s) => s.type === type))) out.push(label);
  const order = (c) => c.sections.map((s) => s.type).join();
  if (!out.length && order(a) !== order(b)) out.push("Section order");
  const pageOf = (c, slug) => JSON.stringify(c.pages.find((p) => p.slug === slug) || null);
  for (const p of b.pages) if (pageOf(a, p.slug) !== pageOf(b, p.slug)) out.push(`“${p.title}” page`);
  const gone = a.pages.filter((p) => !b.pages.some((x) => x.slug === p.slug)).map((p) => p.title);
  if (gone.length) out.push(`removed ${gone.map((t) => `“${t}”`).join(", ")}`);
  if (a.pages.map((p) => p.slug).join() !== b.pages.map((p) => p.slug).join() && !out.some((x) => x.endsWith("page") || x.startsWith("removed"))) out.push("Menu order");
  return out;
}

export async function overLimit(env, siteId) {
  const r = await env.DB.prepare(
    `SELECT SUM(site_id = ?) AS site, COUNT(*) AS total FROM ai_edits WHERE created_at > datetime('now', '-1 day')`
  ).bind(siteId).first();
  if ((r?.site || 0) >= PER_SITE_DAILY) return `Your team has used today’s ${PER_SITE_DAILY} assistant requests. You can still edit everything yourself, or try again tomorrow.`;
  if ((r?.total || 0) >= ALL_SITES_DAILY) return "The assistant is busy today. You can still edit everything yourself, or try again tomorrow.";
  return null;
}

const draftOf = (site) => JSON.parse(site.draft || site.config);
const loadSite = (env, id) => env.DB.prepare("SELECT id, config, draft, draft_rev FROM sites WHERE id = ?").bind(id).first();

// The shared conversation as Messages API turns: consecutive messages from teammates merge into one user turn.
function toTurns(rows) {
  const turns = [];
  for (const r of rows) {
    const text = r.role === "user" ? `${r.author}: ${r.content}` : r.content;
    const last = turns[turns.length - 1];
    if (last && last.role === r.role) last.content += `\n\n${text}`;
    else turns.push({ role: r.role, content: text });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

// One request to the assistant. Returns { reply, changed, rev }; throws if the API call fails.
export async function assistantTurn(env, siteId, editor, text, siteName) {
  const author = editor.name || editor.email;
  const { results: history } = await env.DB.prepare(
    "SELECT m.role, m.content, COALESCE(e.name, e.email, 'Someone') AS author FROM agent_messages m LEFT JOIN editors e ON e.id = m.editor_id WHERE m.site_id = ? ORDER BY m.id DESC LIMIT ?"
  ).bind(siteId, HISTORY).all();
  const messages = toTurns([...history.reverse(), { role: "user", content: text, author }]);

  const start = await loadSite(env, siteId);
  let before = null, rev = start.draft_rev, changedParts = [];
  let seenRev = start.draft_rev; // the draft version the model last read; saves are checked against it, not the newest
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const runTool = async (block) => {
    const site = await loadSite(env, siteId);
    if (block.name === "get_draft") {
      seenRev = site.draft_rev;
      return JSON.stringify(forModel(normalize(draftOf(site))));
    }
    if (block.name === "save_draft") {
      const current = normalize(draftOf(site));
      const next = withMedia(current, block.input.site || {});
      const parts = describeChanges(current, next);
      if (!parts.length) return "Nothing changed — the settings you sent match the draft.";
      const r = await env.DB.prepare("UPDATE sites SET draft = ?, draft_rev = draft_rev + 1, updated_at = datetime('now') WHERE id = ? AND draft_rev = ?")
        .bind(JSON.stringify(next), siteId, seenRev).run();
      if (r.meta.changes !== 1) return "Conflict: someone else saved the draft after you read it. Call get_draft again and redo your change on top of theirs.";
      before ??= site.draft || site.config;
      rev = seenRev = seenRev + 1;
      changedParts = [...new Set([...changedParts, ...parts])];
      return `Saved. Changed: ${parts.join(", ")}.`;
    }
    if (block.name === "suggest_feature")
      return saveRequest(env, { siteId, editorId: editor.id, via: "the website assistant", title: block.input.title, details: block.input.details });
    return "Unknown tool.";
  };

  let reply = "";
  for (let step = 0; step < MAX_STEPS; step++) {
    // Marker on the system block caches tools + instructions across requests; top-level caching covers the growing conversation.
    const res = await client.messages.create({ model: MODEL, max_tokens: 8000, output_config: { effort: "low" }, cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: system(siteName), cache_control: { type: "ephemeral" } }], tools: TOOLS, messages });
    usage.input += res.usage?.input_tokens || 0; // uncached remainder only
    usage.output += res.usage?.output_tokens || 0;
    usage.cacheRead += res.usage?.cache_read_input_tokens || 0;
    usage.cacheWrite += res.usage?.cache_creation_input_tokens || 0;
    if (res.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: res.content });
      const results = [];
      for (const b of res.content.filter((x) => x.type === "tool_use")) results.push({ type: "tool_result", tool_use_id: b.id, content: await runTool(b) });
      messages.push({ role: "user", content: results });
      continue;
    }
    reply = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (res.stop_reason === "refusal") reply = "I can’t help with that one. Try asking for a different change.";
    break;
  }
  if (!reply) reply = changedParts.length ? `I changed: ${changedParts.join(", ")}. Check the preview, then press Publish when you’re happy.` : "Sorry, I couldn’t finish that. Try asking for a smaller change.";

  await env.DB.batch([
    env.DB.prepare("INSERT INTO agent_messages (site_id, editor_id, role, content) VALUES (?, ?, 'user', ?)").bind(siteId, editor.id, text),
    env.DB.prepare("INSERT INTO agent_messages (site_id, editor_id, role, content, changed) VALUES (?, ?, 'assistant', ?, ?)").bind(siteId, editor.id, reply.slice(0, 2000), changedParts.join(", ") || null),
    // ai_edits keeps the daily limit, token counts and Undo working; before_config is the draft before this request.
    env.DB.prepare("INSERT INTO ai_edits (site_id, editor_id, prompt, reply, before_config, after_rev, undone, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(siteId, editor.id, text, reply.slice(0, 2000), before || start.draft || start.config, before ? rev : null, before ? 0 : 1, usage.input, usage.output, usage.cacheRead, usage.cacheWrite),
  ]);
  return { reply, changed: changedParts, rev };
}
