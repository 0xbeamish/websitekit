import { esc, color, portalShell } from "./html.js";
import { normalize, section, PRESETS, DEFAULT_PRESET, FONT_PAIRS, RADII, RHYTHMS } from "./schema.js";

const IMAGE_TYPES = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46, 0x38], webp: null };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const randomId = (bytes = 8) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

const clip = (v, n) => String(v ?? "").trim().slice(0, n);

export const slugify = (name) =>
  clip(name, 200).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "site";

// Accepts "https://www.Example.org/path" and returns "example.org"; null if it isn't a plausible domain.
export function normalizeDomain(raw) {
  const d = String(raw || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!d) return null;
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d) ? d : null;
}

function sniffImage(buf) {
  const b = new Uint8Array(buf.slice(0, 12));
  for (const [ext, sig] of Object.entries(IMAGE_TYPES)) {
    if (sig && sig.every((x, i) => b[i] === x)) return ext;
  }
  const ascii = String.fromCharCode(...b);
  return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP" ? "webp" : null; // SVG deliberately rejected: it can carry script
}

const MIME = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

export async function storeImage(env, siteId, field, file) {
  if (!file || typeof file === "string" || !file.size) return { url: null };
  if (file.size > MAX_IMAGE_BYTES) return { error: `${field === "logo" ? "Logo" : "Photo"} is larger than 5 MB.` };
  const buf = await file.arrayBuffer();
  const ext = sniffImage(buf);
  if (!ext) return { error: `${field === "logo" ? "Logo" : "Photo"} must be a PNG, JPG, GIF or WebP image.` };
  const key = `${siteId}/${field}-${randomId(4)}.${ext}`;
  await env.MEDIA.put(key, buf, { httpMetadata: { contentType: MIME[ext], cacheControl: "public, max-age=31536000, immutable" } });
  return { url: `/media/${key}` };
}

const g = (form, k) => String(form.get(k) ?? "");
const rows = (form, prefix, n, keys) =>
  Array.from({ length: n }, (_, i) => Object.fromEntries(keys.map((k) => [k, g(form, `${prefix}${i}_${k}`)])));

// Form → sections, merged onto the saved ones so anything the form can't show (extra items,
// extra sections, order, kickers set by the assistant) survives a form save. Used by the intake form.
function sectionsFromForm(form, previous) {
  const fromForm = [
    { type: "hero", heading: g(form, "headline"), body: g(form, "tagline"), imageAlt: g(form, "heroImageAlt"), ...(form.get("removeHero") ? { image: "" } : {}) },
    { type: "text", heading: g(form, "aboutHeading") || "About us", body: g(form, "about") },
    { type: "cards", heading: g(form, "workHeading") || "What we do", items: rows(form, "work", 3, ["title", "body"]) },
    { type: "stats", heading: g(form, "statsHeading"), items: rows(form, "stat", 3, ["value", "label"]) },
    { type: "quote", text: g(form, "quote"), by: g(form, "quoteBy") },
    { type: "faq", heading: g(form, "faqHeading"), items: rows(form, "faq", 3, ["q", "a"]) },
    { type: "cta", heading: g(form, "ctaHeading"), body: g(form, "ctaBody"), button: g(form, "ctaButton"), link: g(form, "ctaLink") },
    { type: "contact", body: g(form, "contactBlurb"), email: g(form, "contactEmail"), phone: g(form, "phone"), location: g(form, "location") },
  ];
  const DEFAULTS = { contact: { heading: "Get in touch" } };
  const sections = previous.map((s) => ({ ...s }));
  for (const f of fromForm) {
    const i = sections.findIndex((s) => s.type === f.type); // the form edits the first section of each type
    if (i >= 0) {
      const extra = f.items ? sections[i].items.slice(f.items.length) : [];
      sections[i] = { ...sections[i], ...f, ...(f.items ? { items: [...f.items, ...extra] } : {}) };
    } else {
      const s = { ...DEFAULTS[f.type], ...f };
      const contact = sections.findIndex((x) => x.type === "contact");
      if (f.type === "hero") sections.unshift(s);
      else if (f.type !== "contact" && contact >= 0) sections.splice(contact, 0, s);
      else sections.push(s);
    }
  }
  return sections;
}

export function configFromForm(form, previous = {}) {
  const prev = normalize(previous);
  return {
    name: g(form, "name"),
    theme: { preset: g(form, "preset"), fonts: g(form, "fonts"), radius: g(form, "radius"), rhythm: g(form, "rhythm") },
    logo: form.get("removeLogo") ? "" : prev.logo,
    colors: { primary: g(form, "primaryColor"), accent: g(form, "accentColor"), background: g(form, "backgroundColor") },
    sections: sectionsFromForm(form, prev.sections),
    pages: prev.pages,
  };
}

// Checks every contact and banner section, so each mistake is reported once.
export function sectionErrors(raw) {
  const errors = new Set();
  for (const s of raw.sections || []) {
    if (s.type === "contact" && s.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clip(s.email, 200))) errors.add("Contact email doesn’t look right.");
    if (s.type === "cta" && (s.heading || s.button || s.link) && !(s.heading && s.button && normalize({ sections: [s] }).sections.length))
      errors.add("The banner needs a heading, button text and a link (a web address starting with https:// or an email).");
  }
  return [...errors];
}

// Shared by the intake form and the editor: form → validated config, with uploaded images stored.
export async function buildFromForm(env, siteId, form, previous = {}) {
  const errors = [];
  const raw = configFromForm(form, previous);
  if (!clip(raw.name, 120)) errors.push("Organization name is required.");
  if (!previous.sections && !clip(section(raw, "text")?.body, 10)) errors.push("Please write a few sentences for “About us”."); // intake only; editors may move About to its own page
  errors.push(...sectionErrors(raw));
  const logo = await storeImage(env, siteId, "logo", form.get("logo"));
  const hero = await storeImage(env, siteId, "heroImage", form.get("heroImage"));
  for (const r of [logo, hero]) if (r.error) errors.push(r.error);
  if (logo.url) raw.logo = logo.url;
  if (hero.url) section(raw, "hero").image = hero.url;
  return { errors, raw, config: errors.length ? null : normalize(raw) };
}

// First submission through an invite: creates the site and its owner, who then edits through /edit.
export async function handleIntakePost(env, code, form) {
  const invite = await env.DB.prepare("SELECT * FROM invites WHERE code = ?").bind(code).first();
  if (!invite) return { notFound: true };
  if (invite.site_id) return { used: true, siteId: invite.site_id };

  const siteId = randomId(8);
  const rawDomain = clip(form.get("domain"), 260);
  const domain = rawDomain ? normalizeDomain(rawDomain) : null;
  const { errors, raw, config } = await buildFromForm(env, siteId, form);
  if (rawDomain && !domain) errors.push("Website address doesn’t look like a domain (example: yourgroup.org).");
  if (errors.length) return { errors, config: raw, domain: rawDomain };

  const submitter = [clip(form.get("submitterName"), 120), clip(form.get("submitterEmail"), 200)];
  let slug = slugify(config.name);
  if (await env.DB.prepare("SELECT 1 FROM sites WHERE slug = ?").bind(slug).first()) slug = `${slug}-${randomId(2)}`;
  const json = JSON.stringify(config);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO sites (id, slug, domain, config, draft, submitter_name, submitter_email, invite_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(siteId, slug, domain, json, json, ...submitter, code),
    env.DB.prepare("UPDATE invites SET site_id = ? WHERE code = ? AND site_id IS NULL").bind(siteId, code),
  ]);
  return { siteId, owner: { name: submitter[0], email: submitter[1] } };
}

export const plain = (s) => (s?.startsWith("mailto:") ? s.slice(7) : s);

const select = (name, label, options, value, hint = "") => `<label for="${name}">${label}${hint ? ` <span class="hint">${hint}</span>` : ""}</label>
<select id="${name}" name="${name}">${Object.entries(options).map(([k, v]) => `<option value="${k}"${k === value ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>`;

// A colour picker with its hex code beside it; each updates the other.
export const colorField = (name, label, value) => `<div class="color-field"><label for="${name}">${label}</label>
<div class="color-pair"><input id="${name}" name="${name}" type="color" value="${value}" oninput="this.nextElementSibling.value=this.value">
<input type="text" value="${value}" aria-label="${label} hex code" maxlength="7" spellcheck="false" oninput="if(/^#[0-9a-f]{6}$/i.test(this.value))this.previousElementSibling.value=this.value"></div></div>`;

export const imageField = (name, label, current, removeName, hint) => `<label for="${name}">${label} <span class="hint">${hint}</span></label>
${current ? `<div class="thumb"><img src="${esc(current)}" alt=""><label class="inline"><input type="checkbox" name="${removeName}" value="1"> Remove</label></div>` : ""}
<input id="${name}" name="${name}" type="file" accept="image/png,image/jpeg,image/webp,image/gif">`;

// The editable parts of a site, in the order they appear on the page. Shared by the intake form and /edit.
export function siteGroups(raw = {}, { intake = false } = {}) {
  const c = raw.sections ? raw : normalize(raw); // keep unsaved input as typed when re-showing errors
  const s = (type) => section(c, type) || {};
  const item = (type, i, k) => s(type).items?.[i]?.[k];
  const has = (type) => normalize({ ...c, sections: c.sections || [] }).sections.some((x) => x.type === type);
  const t = c.theme || {};
  const preset = PRESETS[t.preset] ? t.preset : DEFAULT_PRESET;
  const opt = (map, presetDefault) => ({ "": `Match the style (${map[presetDefault]})`, ...map });
  const labels = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.label || v]));
  const P = PRESETS[preset];
  return [
    { id: "identity", title: "Name and logo", body: `
${field("name", "Organization name", c.name, { required: true })}
${imageField("logo", "Logo", c.logo, "removeLogo", "PNG, JPG or WebP, under 5 MB. Shown beside your name and in browser tabs.")}` },
    { id: "look", title: "Style and colours", body: `
<div class="presets" role="radiogroup" aria-label="Style">${Object.entries(PRESETS).map(([k, v]) => `<label class="preset"><input type="radio" name="preset" value="${k}"${k === preset ? " checked" : ""}><span><strong>${esc(v.label)}</strong><span class="hint">${esc(v.blurb)}</span></span></label>`).join("")}</div>
<div class="colors">${colorField("primaryColor", "Main colour", c.colors?.primary || "#17324d")}${colorField("accentColor", "Highlight", c.colors?.accent || "#f2b84b")}${colorField("backgroundColor", "Background", c.colors?.background || "#f7f7f3")}</div>
<p class="hint">Text colour adjusts automatically so it stays readable on whatever you pick.</p>
<details class="more"><summary>Fonts, corners and spacing</summary>
${select("fonts", "Fonts", opt(labels(FONT_PAIRS), P.fonts), t.fonts || "")}
${select("radius", "Corners", opt(RADII, P.radius), t.radius || "")}
${select("rhythm", "Space between sections", opt(RHYTHMS, P.rhythm), t.rhythm || "")}</details>` },
    { id: "hero", title: "Top of the page", body: `
${field("headline", "Headline", s("hero").heading, { hint: "One short line. If blank, we use your name." })}
${field("tagline", "Introduction", s("hero").body, { area: true, hint: "One or two sentences about what you do." })}
${imageField("heroImage", "Photo", s("hero").image, "removeHero", "Optional. Shown beside the headline.")}
${field("heroImageAlt", "Describe the photo", s("hero").imageAlt, { hint: "A few words, read aloud to people using screen readers." })}` },
    { id: "story", title: "About", optional: !intake, shown: has("text"), body: `
${field("aboutHeading", "Heading", s("text").heading, { hint: "Defaults to “About us”." })}
${field("about", "Your story", s("text").body, { area: true, required: intake, hint: "A few short paragraphs. Leave a blank line between paragraphs." })}` },
    { id: "work", title: "What you do", optional: true, shown: has("cards"), body: `
${field("workHeading", "Heading", s("cards").heading, { hint: "Defaults to “What we do”." })}
${[0, 1, 2].map((i) => `<div class="item">${field(`work${i}_title`, `Item ${i + 1}`, item("cards", i, "title"))}${field(`work${i}_body`, `Item ${i + 1} description`, item("cards", i, "body"), { area: true })}</div>`).join("")}` },
    { id: "stats", title: "Numbers", optional: true, shown: has("stats"), body: `
<p class="hint">Big figures, like “1,200” and “members across Ontario”.</p>
${field("statsHeading", "Heading", s("stats").heading)}
${[0, 1, 2].map((i) => `<div class="row2">${field(`stat${i}_value`, `Number ${i + 1}`, item("stats", i, "value"))}${field(`stat${i}_label`, "What it counts", item("stats", i, "label"))}</div>`).join("")}` },
    { id: "quote", title: "Quote", optional: true, shown: has("quote"), body: `
${field("quote", "Quote", s("quote").text, { area: true, hint: "From a member, volunteer or someone you’ve helped." })}
${field("quoteBy", "Who said it", s("quote").by)}` },
    { id: "faq", title: "Questions", optional: true, shown: has("faq"), body: `
${field("faqHeading", "Heading", s("faq").heading, { hint: "Defaults to “Questions people ask”." })}
${[0, 1, 2].map((i) => `<div class="item">${field(`faq${i}_q`, `Question ${i + 1}`, item("faq", i, "q"))}${field(`faq${i}_a`, `Answer ${i + 1}`, item("faq", i, "a"), { area: true })}</div>`).join("")}` },
    { id: "cta", title: "Banner with a button", optional: true, shown: has("cta"), body: `
${field("ctaHeading", "Heading", s("cta").heading, { hint: "For example “Join the union” or “Donate to our strike fund”." })}
${field("ctaBody", "One sentence under it", s("cta").body)}
${field("ctaButton", "Button text", s("cta").button)}
${field("ctaLink", "Where the button goes", plain(s("cta").link), { hint: "A web address starting with https://, or an email address." })}` },
    { id: "contact", title: "Contact", optional: true, shown: has("contact"), body: `
${field("contactBlurb", "A line inviting people to get in touch", s("contact").body, { area: true })}
${field("contactEmail", "Public email address", s("contact").email, { type: "email" })}
${field("phone", "Phone", s("contact").phone, { type: "tel" })}
${field("location", "City or address", s("contact").location)}` },
  ];
}

export const extrasNote = (raw = {}) => {
  const counts = {};
  const hidden = (raw.sections || []).some((x) => (counts[x.type] = (counts[x.type] || 0) + 1) > 1 || x.items?.length > 3);
  return hidden ? `<p class="notice">This page has more sections or items than these fields show (for example, a second text section). They’re kept when you save — to change them, ask the assistant.</p>` : "";
};

// The intake form shows every group as a plain fieldset.
export const siteFields = (raw = {}) =>
  extrasNote(raw) + '<div class="spine">' + siteGroups(raw, { intake: true }).map((g) => `<fieldset><legend>${esc(g.title)}${g.optional ? ' <span class="hint">(optional — leave blank to hide)</span>' : ""}</legend>${g.body}</fieldset>`).join("\n") + "</div>";

export const errorList = (errors) =>
  errors.length ? `<div class="notice" role="alert"><strong>Please fix:</strong><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : "";

export function intakeForm(code, raw = {}, { domain = "", errors = [], submitter = {} } = {}) {
  return portalShell("Start your website", `
<h1>Let’s build your website</h1>
<p class="lead">Fill this in once and you’ll get a private preview straight away, plus your own editing page where you can keep changing anything, add teammates, and describe changes in plain words. Only the sections you fill in appear on your site.</p>
${errorList(errors)}
<form method="post" enctype="multipart/form-data">
${siteFields(raw)}
<fieldset><legend>Your web address</legend>
${field("domain", "Domain you already own", domain, { hint: "For example yourgroup.org. Leave blank if you don’t have one yet — we’ll sort it out together." })}
</fieldset>
<fieldset><legend>Who should we contact?</legend>
${field("submitterName", "Your name", submitter.name, { required: true })}
${field("submitterEmail", "Your email", submitter.email, { type: "email", required: true })}
</fieldset>
<button type="submit">Create my preview</button>
</form>`);
}

export const field = (name, label, value, { type = "text", hint = "", required = false, area = false } = {}) => `
<label for="${name}">${label}${required ? "" : ' <span class="hint">(optional)</span>'}${hint ? `<br><span class="hint">${hint}</span>` : ""}</label>
${area
  ? `<textarea id="${name}" name="${name}"${required ? " required" : ""}>${esc(value)}</textarea>`
  : `<input id="${name}" name="${name}" type="${type}" value="${esc(value)}"${required ? " required" : ""}>`}`;
