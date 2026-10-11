import { esc } from "./html.js";
import { normalize, toSlug } from "./schema.js";
import { field, imageField, plain, siteGroups, storeImage, sectionErrors } from "./portal.js";

// The editor's form: one panel per section, in page order, with every field and item. Fields are numbered by
// position (s3_heading, s3_it1_title); s3_from says which saved section a panel started as, so fields the form
// doesn't show (kickers, photos) carry over. Move, remove and add ride on the same submit as Save, so typed edits survive.

export const SECTION_LABEL = { hero: "Top of the page", text: "Text", cards: "Cards", stats: "Numbers", quote: "Quote", faq: "Questions", cta: "Banner with a button", contact: "Contact" };
export const ADDABLE = Object.keys(SECTION_LABEL).filter((t) => t !== "hero");
const MAX_SECTIONS = 20;

// [key, label, textarea?, hint]
const FIELDS = {
  hero: [["heading", "Headline", false, "One short line. If blank, we use the name."], ["body", "Introduction", true, "One or two sentences."]],
  text: [["heading", "Heading"], ["body", "Text", true, "Leave a blank line between paragraphs."]],
  cards: [["heading", "Heading"], ["intro", "Introduction", true]],
  stats: [["heading", "Heading"]],
  quote: [["text", "Quote", true], ["by", "Who said it"]],
  faq: [["heading", "Heading"]],
  cta: [["heading", "Heading", false, "For example “Join the union”."], ["body", "One sentence under it"], ["button", "Button text"], ["link", "Where the button goes", false, "A web address starting with https://, or an email address."]],
  contact: [["heading", "Heading"], ["body", "A line inviting people to get in touch", true], ["email", "Public email address"], ["phone", "Phone"], ["location", "City or address"]],
};
// Repeating items: [max, item name, [key, label, textarea?]]
const ITEMS = {
  cards: [6, "Card", [["title", "Title"], ["body", "Description", true]]],
  stats: [4, "Number", [["value", "Number"], ["label", "What it counts"]]],
  faq: [8, "Question", [["q", "Question"], ["a", "Answer", true]]],
};

const preview = (s) => String(s.heading || s.text || s.items?.[0]?.title || s.items?.[0]?.q || "").trim();
const short = (t) => (t.length > 48 ? `${t.slice(0, 46)}…` : t);

function sectionBody(s, i, n, prevType, isPage) {
  const f = (k) => `s${i}_${k}`;
  const parts = [`<input type="hidden" name="${f("type")}" value="${s.type}"><input type="hidden" name="${f("from")}" value="${esc(String(s._from ?? ""))}">`];
  for (const [k, label, area, hint] of FIELDS[s.type]) parts.push(field(f(k), label, k === "link" ? plain(s[k]) : s[k], { area, hint, type: k === "email" ? "email" : "text" }));
  if (s.type === "hero") {
    const on = s.buttons === true || s.buttons === "1" || ((s.buttons === null || s.buttons === undefined) && !isPage); // "1" when re-shown after an error
    parts.push(`<label class="inline"><input type="checkbox" name="${f("buttons")}" value="1"${on ? " checked" : ""}> Show the “Learn more” and “Get in touch” buttons</label>
<p class="hint">They link to the next section and to your contact details, when the site has them.</p>`);
    parts.push(imageField(f("image"), "Photo", s.image, f("removeImage"), "Optional. Shown beside the headline."));
    parts.push(field(f("imageAlt"), "Describe the photo", s.imageAlt, { hint: "A few words, read aloud to people using screen readers." }));
  }
  if (ITEMS[s.type]) {
    const [max, name, keys] = ITEMS[s.type];
    const items = s.items || [];
    const shown = Math.min(max, items.length + 1); // one blank slot to add another
    for (let j = 0; j < shown; j++)
      parts.push(`<div class="item${s.type === "stats" ? " row2" : ""}">${keys.map(([k, label, area]) => field(`${f("it" + j)}_${k}`, `${name} ${j + 1}${keys.length > 1 && k !== keys[0][0] ? ` — ${label.toLowerCase()}` : ""}`, items[j]?.[k], { area })).join("")}</div>`);
    parts.push(`<p class="hint">${items.length >= max ? `That’s the most this section holds (${max}).` : `Fill in the empty ${name.toLowerCase()} to add one. Clear one to remove it.`}</p>`);
  }
  if (s.type !== "hero") {
    const up = i > 0 && prevType !== "hero";
    parts.push(`<div class="section-tools">${up ? `<button class="btn small" name="op" value="up:${i}">Move up</button>` : ""}${i < n - 1 ? `<button class="btn small" name="op" value="down:${i}">Move down</button>` : ""}<button class="btn small danger" name="op" value="remove:${i}" data-confirm="Remove this ${SECTION_LABEL[s.type].toLowerCase()} section from the draft?">Remove section</button></div>`);
  }
  return parts.join("\n");
}

// Panels for the editor. `page` = an extra page ({ title, slug, sections }) or null for home; `add` = a section type
// to show as a new, empty panel (it's only kept if it's filled in and saved).
export function editorGroups(cfg, { page = null, add = "" } = {}) {
  const sections = (page ? page.sections : cfg.sections || []).map((s, i) => ({ ...s, _from: s._from ?? i }));
  if (ADDABLE.includes(add) && sections.length < MAX_SECTIONS) {
    const at = sections.at(-1)?.type === "contact" && add !== "contact" ? sections.length - 1 : sections.length; // keep Contact last
    sections.splice(at, 0, { type: add, _from: "", _new: true });
  }
  const head = page
    ? [{ id: "page", title: "Page name and address", body: `
${field("pageTitle", "Page name", page.title, { required: true, hint: "The tab people click in the menu. Keep it short, like “About” or “Get involved”." })}
${field("pageSlug", "Web address", page.slug, { hint: "The part after your domain, like about in yourgroup.org/about. Letters, numbers and dashes." })}` }]
    : siteGroups(cfg).filter((g) => ["identity", "look"].includes(g.id));
  const panels = sections.map((s, i) => ({
    id: s._new ? "new" : `s${i}`, open: s._new,
    title: short(preview(s)) || SECTION_LABEL[s.type], chip: SECTION_LABEL[s.type],
    body: sectionBody(s, i, sections.length, sections[i - 1]?.type, Boolean(page)),
  }));
  const addRow = sections.length < MAX_SECTIONS
    ? `<div class="add-section"><label for="addType">Add a section</label><select id="addType" name="addType">${ADDABLE.map((t) => `<option value="${t}">${SECTION_LABEL[t]}</option>`).join("")}</select><button class="btn small" name="op" value="add">Add</button></div>`
    : `<p class="hint">This page has the most sections it can hold (${MAX_SECTIONS}).</p>`;
  return { groups: [...head, ...panels], count: sections.length, addRow };
}

const g = (form, k) => String(form.get(k) ?? "");

function sectionsFromForm(form, previous, isPage) {
  const n = Math.min(Number(form.get("count")) || 0, MAX_SECTIONS + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const type = g(form, `s${i}_type`);
    if (!FIELDS[type]) continue;
    const from = g(form, `s${i}_from`);
    const base = from !== "" && previous[Number(from)]?.type === type ? previous[Number(from)] : {};
    const s = { ...base, type, _from: from, _i: i };
    for (const [k] of FIELDS[type]) s[k] = g(form, `s${i}_${k}`);
    if (type === "hero") {
      s.imageAlt = g(form, `s${i}_imageAlt`);
      const on = Boolean(form.get(`s${i}_buttons`));
      s.buttons = on === !isPage ? null : on; // the default is stored as null, so a save without edits changes nothing
      if (form.get(`s${i}_removeImage`)) s.image = "";
    }
    if (ITEMS[type]) {
      const [max, , keys] = ITEMS[type];
      s.items = Array.from({ length: max }, (_, j) => Object.fromEntries(keys.map(([k]) => [k, g(form, `s${i}_it${j}_${k}`)])))
        .filter((it) => Object.values(it).some((v) => v.trim())); // blank slots aren't items
    }
    out.push(s);
  }
  return out;
}

// Applies "up:3", "down:3" or "remove:3" (form positions) to the sections built from the form.
function applyOp(sections, op) {
  const m = op.match(/^(up|down|remove):(\d+)$/);
  if (!m) return;
  const i = sections.findIndex((s) => s._i === Number(m[2]));
  if (i < 0 || sections[i].type === "hero") return;
  if (m[1] === "remove") sections.splice(i, 1);
  else {
    const j = i + (m[1] === "up" ? -1 : 1);
    if (j >= 0 && j < sections.length && sections[j].type !== "hero") [sections[i], sections[j]] = [sections[j], sections[i]];
  }
}

// Form → whole config for home (slug "") or one extra page. Returns { errors, raw, config, slug, add }.
export async function buildEditorForm(env, siteId, form, previous, slug = "") {
  const prev = normalize(previous);
  const page = slug ? prev.pages.find((p) => p.slug === slug) : null;
  const errors = [];
  const sections = sectionsFromForm(form, page ? page.sections : prev.sections, Boolean(page));
  const op = g(form, "op");
  applyOp(sections, op);
  for (const s of sections) {
    if (s.type !== "hero") continue;
    const img = await storeImage(env, siteId, "heroImage", form.get(`s${s._i}_image`));
    if (img.error) errors.push(img.error);
    if (img.url) s.image = img.url;
  }
  errors.push(...sectionErrors({ sections }));
  let raw, newSlug = slug;
  if (page) {
    const title = g(form, "pageTitle").trim();
    if (!title) errors.push("The page needs a name — it’s the tab people click in the menu.");
    const wanted = g(form, "pageSlug").trim() ? toSlug(g(form, "pageSlug")) : page.slug;
    if (prev.pages.some((p) => p !== page && p.slug === wanted)) errors.push(`Another page already uses the address /${wanted}.`);
    if (!errors.length) newSlug = wanted;
    raw = { ...prev, pages: prev.pages.map((p) => (p === page ? { title: g(form, "pageTitle"), slug: newSlug, sections } : p)) };
  } else {
    raw = {
      name: g(form, "name"),
      theme: { preset: g(form, "preset"), fonts: g(form, "fonts"), radius: g(form, "radius"), rhythm: g(form, "rhythm") },
      logo: form.get("removeLogo") ? "" : prev.logo,
      colors: { primary: g(form, "primaryColor"), accent: g(form, "accentColor"), background: g(form, "backgroundColor") },
      sections, pages: prev.pages,
    };
    if (!raw.name.trim()) errors.push("Organization name is required.");
    const logo = await storeImage(env, siteId, "logo", form.get("logo"));
    if (logo.error) errors.push(logo.error);
    if (logo.url) raw.logo = logo.url;
  }
  const add = op === "add" && ADDABLE.includes(g(form, "addType")) ? g(form, "addType") : "";
  return { errors, raw, slug: newSlug, add, config: errors.length ? null : normalize(raw) };
}
