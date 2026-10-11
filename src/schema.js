import { color } from "./html.js";

// The single definition of what a site config may contain. Form input, stored configs and
// (later) AI edits all pass through normalize(), so nothing outside these fields renders.

// A site's look = a preset plus optional overrides. An empty override means "use the preset's choice".
export const PRESETS = {
  civic: { label: "Civic", blurb: "Calm and trustworthy: serif headings, clear sections.", fonts: "civic", radius: "soft", rhythm: "comfortable" },
  grassroots: { label: "Grassroots", blurb: "Loud and direct: huge type, flat blocks of colour.", fonts: "grotesk", radius: "square", rhythm: "comfortable" },
  bulletin: { label: "Bulletin", blurb: "Newsy: ruled columns, like a printed bulletin.", fonts: "news", radius: "square", rhythm: "compact" },
  warm: { label: "Warm", blurb: "Friendly: rounded shapes and soft colour.", fonts: "friendly", radius: "round", rhythm: "spacious" },
  modern: { label: "Modern", blurb: "Clean and confident: bold sans-serif, plenty of space, quiet outlined boxes.", fonts: "modern", radius: "soft", rhythm: "spacious" },
  magazine: { label: "Magazine", blurb: "Expressive: big serif headlines with italics, like a magazine feature.", fonts: "magazine", radius: "square", rhythm: "comfortable" },
};
export const DEFAULT_PRESET = "civic";
export const FONT_PAIRS = {
  civic: { label: "Source Serif + Public Sans", head: "Source Serif 4", body: "Public Sans", q: "family=Source+Serif+4:opsz,wght@8..60,500;8..60,700&family=Public+Sans:wght@400;600;700" },
  grotesk: { label: "Archivo", head: "Archivo", body: "Archivo", q: "family=Archivo:wdth,wght@62..125,400;62..125,600;62..125,800" },
  news: { label: "Newsreader + Libre Franklin", head: "Newsreader", body: "Libre Franklin", q: "family=Newsreader:opsz,wght@6..72,500;6..72,700&family=Libre+Franklin:wght@400;600;700" },
  friendly: { label: "Young Serif + Figtree", head: "Young Serif", body: "Figtree", q: "family=Young+Serif&family=Figtree:wght@400;600;700" },
  modern: { label: "Inter Tight + Inter", head: "Inter Tight", body: "Inter", q: "family=Inter+Tight:wght@600;700;800&family=Inter:wght@400;600;700" },
  magazine: { label: "Fraunces + Inter", head: "Fraunces", body: "Inter", q: "family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,700;1,9..144,500&family=Inter:wght@400;600;700" },
};
export const RADII = { square: "Square", soft: "Slightly rounded", round: "Rounded" };
export const RHYTHMS = { compact: "Compact", comfortable: "Comfortable", spacious: "Spacious" };
const LEGACY_STYLE = { classic: "civic", bold: "grassroots", editorial: "civic" }; // configs saved before presets existed

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const list = (v, max, fn) => (Array.isArray(v) ? v : []).slice(0, max).map(fn).filter(Boolean);
const link = (v) => {
  const s = clip(v, 500);
  if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (/^mailto:[^\s@"'<>]+@[^\s"'<>]+$/i.test(s)) return s;
  return /^[^\s@"'<>]+@[^\s@"'<>]+\.[^\s"'<>]+$/.test(s) ? `mailto:${s}` : "";
};
const media = (v) => (/^\/media\/[0-9a-f]{16}\/[a-zA-Z]+-[0-9a-f]{8}\.(png|jpg|gif|webp)$/.test(v || "") ? v : "");

// Each section type: how to clean it, and whether it has enough content to show.
const SECTIONS = {
  // buttons: show "Learn more" / "Get in touch"; null = the default (on for home, off for other pages)
  hero: (s) => ({ type: "hero", heading: clip(s.heading, 160), body: clip(s.body, 400), image: media(s.image), imageAlt: clip(s.imageAlt, 200), buttons: typeof s.buttons === "boolean" ? s.buttons : null }),
  text: (s) => ({ type: "text", kicker: clip(s.kicker, 40), heading: clip(s.heading, 120), body: clip(s.body, 4000) }),
  cards: (s) => ({
    type: "cards", kicker: clip(s.kicker, 40), heading: clip(s.heading, 120), intro: clip(s.intro, 600),
    items: list(s.items, 6, (i) => (i?.title || i?.body ? { title: clip(i.title, 80), body: clip(i.body, 1500) } : null)),
  }),
  stats: (s) => ({
    type: "stats", heading: clip(s.heading, 120),
    items: list(s.items, 4, (i) => (i?.value ? { value: clip(i.value, 20), label: clip(i.label, 80) } : null)),
  }),
  quote: (s) => ({ type: "quote", text: clip(s.text, 600), by: clip(s.by, 120) }),
  faq: (s) => ({
    type: "faq", heading: clip(s.heading, 120),
    items: list(s.items, 8, (i) => (i?.q ? { q: clip(i.q, 200), a: clip(i.a, 1000) } : null)),
  }),
  cta: (s) => ({ type: "cta", heading: clip(s.heading, 160), body: clip(s.body, 400), button: clip(s.button, 40), link: link(s.link) }),
  contact: (s) => ({
    type: "contact", heading: clip(s.heading, 120), body: clip(s.body, 600),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email || "") ? clip(s.email, 200) : "", phone: clip(s.phone, 60), location: clip(s.location, 160),
  }),
  // A message form (name, email, message). Messages are stored for the editors; button and thanks "" = the default wording.
  form: (s) => ({ type: "form", heading: clip(s.heading, 120), body: clip(s.body, 600), button: clip(s.button, 40), thanks: clip(s.thanks, 300) }),
};

const hasContent = {
  hero: () => true,
  text: (s) => s.body,
  cards: (s) => s.items.length,
  stats: (s) => s.items.length,
  quote: (s) => s.text,
  faq: (s) => s.items.length,
  cta: (s) => s.heading && s.button && s.link,
  contact: (s) => s.email || s.phone || s.location || s.body,
  form: (s) => s.heading,
};

export const MAX_PAGES = 8; // extra pages besides home; each is a tab in the menu
const RESERVED = new Set(["edit", "signin", "media", "preview", "auth", "admin", "start", "privacy", "home"]); // paths the worker or the menu already uses
const slugOk = (s) => typeof s === "string" && /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s) && !RESERVED.has(s);
export const toSlug = (title) => {
  const s = String(title || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34).replace(/-+$/, "") || "page";
  return RESERVED.has(s) ? `${s}-page` : s;
};
export const uniqueSlug = (slug, taken) => {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  return out;
};

const cleanSections = (v) => list(v, 20, (s) => (SECTIONS[s?.type] ? SECTIONS[s.type](s) : null)).filter((s) => hasContent[s.type](s));

// Extra pages: a title (the menu tab), a slug (the address, /slug) and their own sections. `sections` stays the home page.
function cleanPages(v) {
  const taken = new Set();
  return list(v, MAX_PAGES, (p) => {
    const title = clip(p?.title, 40);
    if (!title) return null;
    const slug = uniqueSlug(slugOk(p.slug) ? p.slug : toSlug(title), taken);
    taken.add(slug);
    return { title, slug, rhythm: RHYTHMS[p.rhythm] ? p.rhythm : "", sections: cleanSections(p.sections) }; // rhythm "" = the site's spacing
  });
}

export function normalize(raw = {}) {
  const c = raw.sections ? raw : fromV1(raw);
  return {
    version: 2,
    name: clip(c.name, 120),
    theme: theme(c),
    logo: media(c.logo),
    colors: {
      primary: color(c.colors?.primary, "#17324d"),
      accent: color(c.colors?.accent, "#f2b84b"),
      background: color(c.colors?.background, "#f7f7f3"),
      header: color(c.colors?.header, ""), // "" = the page background
      footer: color(c.colors?.footer, ""),
    },
    sections: cleanSections(c.sections),
    pages: cleanPages(c.pages),
  };
}

function theme(c) {
  const t = c.theme || {};
  const preset = PRESETS[t.preset] ? t.preset : LEGACY_STYLE[c.style] || DEFAULT_PRESET;
  return { preset, fonts: FONT_PAIRS[t.fonts] ? t.fonts : "", radius: RADII[t.radius] ? t.radius : "", rhythm: RHYTHMS[t.rhythm] ? t.rhythm : "" };
}

// The theme with the preset's defaults filled in, for rendering.
export const resolvedTheme = (t) => {
  const p = PRESETS[t.preset];
  return { preset: t.preset, fonts: t.fonts || p.fonts, radius: t.radius || p.radius, rhythm: t.rhythm || p.rhythm };
};

// Configs saved before sections existed (flat fields) map onto the same layout they rendered as.
function fromV1(c) {
  return {
    name: c.name, logo: c.logo, style: "classic",
    colors: { primary: c.primaryColor, accent: c.accentColor, background: c.backgroundColor },
    sections: [
      { type: "hero", heading: c.headline || c.name, body: c.tagline, image: c.heroImage, imageAlt: c.heroImageAlt },
      { type: "text", kicker: "Our story", heading: "About us", body: c.about },
      { type: "cards", kicker: "Our work", heading: "What we do", items: c.work?.items },
      { type: "contact", heading: "Get in touch", body: c.contactBlurb, email: c.contactEmail, phone: c.phone, location: c.location },
    ],
  };
}

export const section = (cfg, type) => cfg.sections.find((s) => s.type === type);
