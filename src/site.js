import { esc } from "./html.js";
import { normalize, resolvedTheme, FONT_PAIRS } from "./schema.js";

// Relative luminance of a #rrggbb colour, so text and buttons stay readable on any colour an org picks.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const on = (hex) => (lum(hex) > 0.4 ? "#16191d" : "#ffffff");

const RADIUS = { square: "0px", soft: "8px", round: "22px" };
const RHYTHM = { compact: "4rem", comfortable: "6rem", spacious: "8rem" }; // the gap between sections

const NAV_LABEL = { text: (s) => s.heading || "About", cards: (s) => s.heading || "What we do", faq: (s) => s.heading || "Questions", contact: () => "Contact" };

const paragraphs = (text, cls = "") =>
  String(text || "").split(/\n\s*\n/).filter((p) => p.trim())
    .map((p) => `<p${cls ? ` class="${cls}"` : ""}>${esc(p.trim())}</p>`).join("");

const RENDER = {
  hero: (s, c) => `<section class="hero${s.image ? " has-art" : ""}"><div class="wrap hero-inner">
  <div class="hero-copy"><h1>${esc(s.heading || c.name)}</h1>${s.body ? `<p class="lede">${esc(s.body)}</p>` : ""}
  ${(s.buttons ?? !c.isPage) && (c.learnHref || c.contactHref) ? `<div class="actions">${c.learnHref ? `<a class="button primary" href="${esc(c.learnHref)}">Learn more</a>` : ""}${c.contactHref ? `<a class="button ghost" href="${esc(c.contactHref)}">Get in touch</a>` : ""}</div>` : ""}</div>
  ${s.image ? `<figure class="hero-art"><img src="${esc(s.image)}" alt="${esc(s.imageAlt)}"></figure>` : ""}</div></section>`,
  text: (s) => `<section class="text"><div class="wrap measure">${s.heading ? `<h2>${esc(s.heading)}</h2>` : ""}<div class="prose">${paragraphs(s.body)}</div></div></section>`,
  cards: (s) => `<section class="cards-section"><div class="wrap">${s.heading ? `<h2>${esc(s.heading)}</h2>` : ""}${s.intro ? `<p class="intro">${esc(s.intro)}</p>` : ""}
  <div class="cards">${s.items.map((i) => `<article class="card">${i.title ? `<h3>${esc(i.title)}</h3>` : ""}<p>${esc(i.body)}</p></article>`).join("")}</div></div></section>`,
  stats: (s) => `<section class="stats-section"><div class="wrap">${s.heading ? `<h2>${esc(s.heading)}</h2>` : ""}
  <dl class="stats">${s.items.map((i) => `<div class="stat"><dt>${esc(i.label)}</dt><dd>${esc(i.value)}</dd></div>`).join("")}</dl></div></section>`,
  quote: (s) => `<section class="quote-section"><div class="wrap measure"><figure><blockquote>${esc(s.text)}</blockquote>${s.by ? `<figcaption>${esc(s.by)}</figcaption>` : ""}</figure></div></section>`,
  faq: (s) => `<section class="faq-section"><div class="wrap measure"><h2>${esc(s.heading || "Questions people ask")}</h2>
  <div class="faq">${s.items.map((i) => `<details><summary>${esc(i.q)}</summary>${paragraphs(i.a)}</details>`).join("")}</div></div></section>`,
  cta: (s) => `<section class="cta"><div class="wrap cta-inner"><div><h2>${esc(s.heading)}</h2>${s.body ? `<p>${esc(s.body)}</p>` : ""}</div>
  <a class="button cta-button" href="${esc(s.link)}"${s.link.startsWith("http") ? ' rel="noopener noreferrer"' : ""}>${esc(s.button)}</a></div></section>`,
  contact: (s) => {
    const details = [s.phone, s.location].filter(Boolean);
    return `<section class="contact"><div class="wrap contact-inner"><div><h2>${esc(s.heading || "Get in touch")}</h2>${paragraphs(s.body)}</div>
  <div class="contact-actions">${s.email ? `<a class="button primary" href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : ""}${details.map((d) => `<p>${esc(d)}</p>`).join("")}</div></div></section>`;
  },
};

// One page of a site: home when `page` is "", else the extra page with that slug (null if there isn't one).
// `href` turns a slug into a link, so the editor's preview can keep visitors inside the preview.
export function renderSite(raw, { page = "", href = (slug) => (slug ? `/${slug}` : "/") } = {}) {
  const c = normalize(raw);
  const current = page ? c.pages.find((p) => p.slug === page) : null;
  if (page && !current) return null;
  const sections = current ? current.sections : c.sections;
  const t = resolvedTheme(c.theme);
  const fonts = FONT_PAIRS[t.fonts];
  const ids = sections.map((s, i) => `${s.type}-${i}`);
  const anchor = (test) => { const i = sections.findIndex(test); return i >= 0 ? `#${ids[i]}` : null; };
  const isContact = (s) => s.type === "contact";
  const multi = c.pages.length > 0;
  // With extra pages the menu links pages; without, it scrolls to sections of the one page.
  const navItems = multi
    ? [["Home", href(""), !current], ...c.pages.map((p) => [p.title, href(p.slug), p === current])]
    : sections.map((s, i) => (NAV_LABEL[s.type] ? [NAV_LABEL[s.type](s), `#${ids[i]}`, false] : null)).filter(Boolean);
  const contactPage = c.sections.some(isContact) ? "" : c.pages.find((p) => p.sections.some(isContact))?.slug;
  const ctx = {
    name: current ? current.title : c.name,
    isPage: Boolean(current),
    learnHref: anchor((s) => !["hero", "contact"].includes(s.type)) || (multi && !current ? href(c.pages[0].slug) : null),
    contactHref: anchor(isContact) || (multi && contactPage !== undefined ? href(contactPage) : null),
  };
  const body = sections.map((s, i) => RENDER[s.type](s, ctx).replace(/^<section/, `<section id="${ids[i]}"`)).join("\n");
  const { primary, accent, background, header, footer } = c.colors;
  const rhythm = RHYTHM[current?.rhythm || t.rhythm];
  const band = (name, bg) => (bg ? `;--${name}-bg:${bg};--${name}-ink:${on(bg)}` : ""); // a coloured header or footer, with readable text
  const dark = lum(background) < 0.2;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(current ? `${current.title} · ${c.name}` : c.name)}</title>
<meta name="description" content="${esc((sections.find((s) => s.type === "hero") || c.sections.find((s) => s.type === "hero"))?.body || "")}">
<meta name="theme-color" content="${background}">
${c.logo ? `<link rel="icon" href="${esc(c.logo)}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts.q}&display=swap">
<link rel="stylesheet" href="/_kit/site.css?v=${CSS_VERSION}">
<style>:root{--primary:${primary};--accent:${accent};--background:${background};--on-primary:${on(primary)};--on-accent:${on(accent)};
--head:"${fonts.head}",Georgia,serif;--body:"${fonts.body}",system-ui,sans-serif;--radius:${RADIUS[t.radius]};--rhythm:${rhythm}${band("header", header)}${band("footer", footer)}${
  dark ? ";--ink:#ffffff;--muted:rgba(255,255,255,.84);--rule:rgba(255,255,255,.32);--tint:rgba(255,255,255,.08)" : ""}}</style>
</head><body class="p-${t.preset}${dark ? " dark" : ""}${header ? " has-header" : ""}${footer ? " has-footer" : ""}">
<a class="skip" href="#main">Skip to content</a>
<header class="masthead"><div class="wrap masthead-inner">
  <a class="brand" href="${multi ? esc(href("")) : "#top"}">${c.logo ? `<img src="${esc(c.logo)}" alt="" class="brand-logo">` : ""}<span>${esc(c.name)}</span></a>
  ${navItems.length ? `<button class="menu-button" aria-expanded="false" aria-controls="main-nav" onclick="var o=this.getAttribute('aria-expanded')==='true';this.setAttribute('aria-expanded',!o);document.getElementById('main-nav').classList.toggle('open',!o)">Menu</button>
  <nav id="main-nav" class="nav" aria-label="Main">${navItems.map(([l, h, cur]) => `<a href="${esc(h)}"${cur ? ' aria-current="page"' : ""}>${esc(l)}</a>`).join("")}</nav>` : ""}
</div></header>
<main id="main"><span id="top"></span>
${body}
</main>
<footer class="foot"><div class="wrap"><p>© ${new Date().getUTCFullYear()} ${esc(c.name)}</p></div></footer>
</body></html>`;
}

// Shared structure, then one block per preset. Presets change type, layout and surface treatment — not just colour.
export const SITE_CSS = `
:root{--ink:#16191d;--muted:#4f5862;--rule:rgba(22,25,29,.16);--tint:color-mix(in srgb,var(--primary) 7%,var(--background));--wrap:1120px}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--background);color:var(--ink);font-family:var(--body);font-size:1.0625rem;line-height:1.65;-webkit-font-smoothing:antialiased}
section[id]{scroll-margin-top:5rem}img{max-width:100%;display:block}a{color:inherit}
h1,h2,h3{font-family:var(--head);line-height:1.08;margin:0 0 .6em;text-wrap:balance}
h1{font-size:clamp(2.5rem,6.5vw,4.75rem);letter-spacing:-.02em}h2{font-size:clamp(1.75rem,3.6vw,2.6rem);letter-spacing:-.01em}h3{font-size:1.25rem}
p{margin:0 0 1em}.wrap{width:min(var(--wrap),100% - 2.5rem);margin-inline:auto}.measure>*{max-width:44rem}
.skip{position:absolute;left:-999px}.skip:focus{left:1rem;top:1rem;z-index:20;background:var(--background);padding:.5rem 1rem}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.masthead{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--background) 94%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--rule)}
.masthead-inner{display:flex;align-items:center;justify-content:space-between;gap:1.5rem;min-height:4.25rem}
.brand{display:flex;align-items:center;gap:.65rem;text-decoration:none;font-weight:700;font-family:var(--head);font-size:1.1rem}
.brand-logo{width:2.1rem;height:2.1rem;object-fit:contain;border-radius:calc(var(--radius) / 2)}
.nav{display:flex;gap:1.6rem}.nav a{text-decoration:none;font-weight:600;font-size:.95rem}.nav a:hover{text-decoration:underline;text-underline-offset:.3em}.nav a[aria-current=page]{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:.3em}
.menu-button{display:none;font:inherit;font-weight:600;color:inherit;background:none;border:1px solid var(--rule);border-radius:var(--radius);padding:.5rem .85rem}
section{padding-block:calc(var(--rhythm) / 2)}
.hero{padding-block:calc(var(--rhythm) * .8)}.hero-inner{display:grid;gap:3rem;align-items:center}.hero.has-art .hero-inner{grid-template-columns:1.1fr .9fr}
.lede{font-size:clamp(1.15rem,2vw,1.35rem);color:var(--muted);max-width:36rem}
.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:2rem}
.button{display:inline-block;text-decoration:none;font-weight:700;padding:.85rem 1.3rem;border-radius:var(--radius);border:2px solid var(--primary);line-height:1.2}
.button.primary{background:var(--primary);color:var(--on-primary)}.button.ghost{color:var(--primary)}
.dark .button.ghost{color:var(--ink);border-color:var(--ink)}
.hero-art{margin:0}.hero-art img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius)}
.prose p{font-size:1.15rem}.intro{max-width:40rem;color:var(--muted);font-size:1.1rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1.25rem;margin-top:2rem}.card p:last-child{margin:0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:2rem;margin:1.5rem 0 0}
.stat{display:flex;flex-direction:column-reverse}.stat dd{margin:0;font-family:var(--head);font-size:clamp(2.4rem,5vw,3.5rem);line-height:1;font-weight:700;color:var(--primary)}
.dark .stat dd{color:var(--ink)}.stat dt{color:var(--muted);margin-top:.5rem}
.quote-section figure{margin:0}blockquote{margin:0;font-family:var(--head);font-size:clamp(1.5rem,3.4vw,2.3rem);line-height:1.3}
figcaption{margin-top:1rem;color:var(--muted);font-weight:600}figcaption::before{content:"— "}
.faq details{border-top:1px solid var(--rule);padding:1.1rem 0}.faq details:last-child{border-bottom:1px solid var(--rule)}
.faq summary{cursor:pointer;font-weight:700;font-size:1.1rem;list-style:none;display:flex;justify-content:space-between;gap:1rem}.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font-weight:400;font-size:1.4rem;line-height:1}.faq details[open] summary::after{content:"−"}.faq details p{color:var(--muted);margin:.75rem 0 0}
.cta{background:var(--primary);color:var(--on-primary)}.cta-inner{display:flex;flex-wrap:wrap;gap:2rem;align-items:center;justify-content:space-between}
.cta h2{margin-bottom:.3em}.cta p{margin:0;opacity:.9;max-width:38rem}
.cta-button{background:var(--on-primary);color:var(--primary);border-color:var(--on-primary)}
.contact-inner{display:grid;grid-template-columns:1fr auto;gap:2rem;align-items:end}.contact-actions p{margin:.6rem 0 0;color:var(--muted)}
.foot{border-top:1px solid var(--rule);padding:2rem 0;color:var(--muted);font-size:.92rem}.foot p{margin:0}
@media (prefers-reduced-motion:no-preference){.hero-copy{animation:rise .7s cubic-bezier(.2,.7,.2,1) both}.hero-art{animation:rise .7s .12s cubic-bezier(.2,.7,.2,1) both}
@keyframes rise{from{opacity:0;transform:translateY(14px)}}}

/* Coloured header and footer: they set their own ink, so every preset's rules and links follow */
.has-header .masthead{--ink:var(--header-ink);--rule:color-mix(in srgb,var(--header-ink) 30%,transparent);background:var(--header-bg);color:var(--ink);backdrop-filter:none;border-bottom-color:transparent}
.has-footer .foot{--ink:var(--footer-ink);--muted:var(--footer-ink);background:var(--footer-bg);color:var(--footer-ink);border-top:0}

/* Civic: calm, serif display, thin rules, a coloured underline as the only flourish */
.p-civic h2::after{content:"";display:block;width:3rem;height:3px;background:var(--primary);margin-top:.5em}
.p-civic.dark h2::after{background:var(--ink)}
.p-civic .card{padding-top:1rem;border-top:2px solid var(--primary)}.p-civic.dark .card{border-color:var(--ink)}
.p-civic .cards-section{background:color-mix(in srgb,var(--accent) 12%,var(--background))}.p-civic.dark .cards-section{background:var(--tint)}
.p-civic h1{font-weight:700}.p-civic .brand{font-weight:700}

/* Grassroots: poster energy, huge condensed caps, flat solid blocks */
.p-grassroots h1,.p-grassroots h2{font-stretch:75%;font-weight:800;text-transform:uppercase;letter-spacing:-.01em;line-height:.95}
.p-grassroots h1{font-size:clamp(3rem,10vw,7.5rem)}.p-grassroots h2{font-size:clamp(2.2rem,6vw,4rem)}
.p-grassroots .masthead{border-bottom:3px solid var(--ink)}.p-grassroots .brand{font-weight:800;text-transform:uppercase;font-stretch:80%;letter-spacing:.01em}.p-grassroots .nav a{text-transform:uppercase;letter-spacing:.06em;font-size:.85rem}
.p-grassroots .hero{background:var(--primary);color:var(--on-primary)}.p-grassroots .hero .lede{color:var(--on-primary);opacity:.9}
.p-grassroots .hero .button.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.p-grassroots .hero .button.ghost{color:var(--on-primary);border-color:var(--on-primary)}
.p-grassroots.dark .hero{background:transparent;color:var(--ink);border-bottom:3px solid var(--ink)}.p-grassroots.dark .hero .lede{color:var(--muted)}.p-grassroots.dark .hero .button.ghost{color:var(--ink);border-color:var(--ink)}
.p-grassroots .cards{gap:0;border:3px solid var(--ink)}.p-grassroots .card{padding:1.75rem;border-right:3px solid var(--ink)}.p-grassroots .card:last-child{border-right:0}
.p-grassroots .card h3{font-family:var(--head);font-weight:800;text-transform:uppercase;font-stretch:75%;font-size:1.5rem}
.p-grassroots .quote-section{background:var(--accent);color:var(--on-accent)}.p-grassroots.dark .quote-section{background:transparent}
.p-grassroots blockquote{font-weight:800;text-transform:uppercase;font-stretch:75%;font-size:clamp(2rem,5vw,3.4rem);line-height:1}
.p-grassroots .quote-section figcaption{color:inherit}.p-grassroots .stat dd{font-size:clamp(3rem,8vw,5.5rem);font-stretch:75%}

/* Bulletin: a printed newsletter — centred masthead, column rules, newsprint headings */
.p-bulletin .masthead{position:static;border-bottom:0}.p-bulletin .masthead-inner{flex-direction:column;gap:.4rem;padding:1.6rem 0 0}
.p-bulletin .brand{font-size:clamp(1.8rem,4.5vw,3rem);font-weight:700;letter-spacing:-.02em}
.p-bulletin .nav{border-block:3px double var(--ink);width:100%;justify-content:center;padding:.55rem 0;margin-top:.6rem}
.p-bulletin .nav a{font-size:.8rem;text-transform:uppercase;letter-spacing:.12em}
.p-bulletin h1{font-weight:700;font-size:clamp(2.4rem,6vw,4.25rem)}.p-bulletin h2{font-weight:700;border-bottom:1px solid var(--ink);padding-bottom:.3em}
.p-bulletin section+section{border-top:1px solid var(--rule)}
.p-bulletin .hero .hero-inner{grid-template-columns:1fr}.p-bulletin .hero.has-art .hero-inner{grid-template-columns:1.2fr 1fr}
.p-bulletin .text .measure>*{max-width:none}.p-bulletin .quote-section figure{margin-inline:auto}.p-bulletin .prose{columns:2 20rem;column-gap:3rem;column-rule:1px solid var(--rule)}
.p-bulletin .prose p:first-child::first-letter{float:left;font-family:var(--head);font-size:3.6em;line-height:.85;padding:.05em .1em 0 0;font-weight:700}
.p-bulletin .cards{gap:0}.p-bulletin .card{padding:0 1.5rem;border-left:1px solid var(--rule)}.p-bulletin .card:first-child{border-left:0;padding-left:0}
.p-bulletin .card h3{font-family:var(--head);font-size:1.35rem}
.p-bulletin blockquote{border-block:3px double var(--ink);padding:1.5rem 0;text-align:center;font-style:italic}.p-bulletin figcaption{text-align:center}
.p-bulletin .stat{border-left:1px solid var(--rule);padding-left:1rem}
.p-bulletin .cta{background:none;color:var(--ink);border-block:3px double var(--ink)}.p-bulletin .cta-button{background:var(--primary);color:var(--on-primary);border-color:var(--primary)}
.p-bulletin.dark .cta-button{background:var(--ink);color:var(--background);border-color:var(--ink)}

/* Warm: soft, rounded, tinted panels and pill shapes */
.p-warm .nav a{padding:.35rem .8rem;border-radius:99px}.p-warm .nav a:hover,.p-warm .nav a[aria-current=page]{background:var(--tint);text-decoration:none}
.p-warm .button{border-radius:99px}
.p-warm .hero .wrap{background:var(--tint);border-radius:var(--radius);padding:clamp(2rem,5vw,4rem)}
.p-warm .card{background:var(--tint);border-radius:var(--radius);padding:1.6rem}
.p-warm .card:nth-child(3n+2){background:color-mix(in srgb,var(--accent) 16%,var(--background))}
.p-warm.dark .card:nth-child(3n+2){background:var(--tint)}
.p-warm blockquote{background:var(--tint);border-radius:var(--radius);padding:2rem 2.25rem}
.p-warm .cta .cta-inner{background:var(--primary);border-radius:var(--radius);padding:2.5rem}.p-warm .cta{background:none;color:var(--on-primary)}
.p-warm .faq details{border:0;background:var(--tint);border-radius:calc(var(--radius) * .7);padding:1rem 1.25rem;margin-bottom:.6rem}

/* Modern: clean sans-serif, generous space, outlined boxes and one bold accent bar */
.p-modern h1,.p-modern h2{font-weight:800;letter-spacing:-.035em}.p-modern h1{font-size:clamp(2.6rem,7vw,5.25rem)}
.p-modern .masthead{border-bottom:0}.p-modern .brand{font-weight:800;letter-spacing:-.02em}
.p-modern .nav a{opacity:.75}.p-modern .nav a:hover,.p-modern .nav a[aria-current=page]{opacity:1}
.p-modern .hero h1::after{content:"";display:block;width:4.5rem;height:6px;margin-top:.35em;border-radius:3px;background:var(--accent)}
.p-modern .card{border:1px solid var(--rule);border-radius:var(--radius);padding:1.6rem}
.p-modern .stat dd,.p-modern blockquote{font-weight:800;letter-spacing:-.03em}
.p-modern .faq details{border:1px solid var(--rule);border-radius:var(--radius);padding:1rem 1.25rem;margin-bottom:.6rem}

/* Magazine: large serif headlines, italic subheads, thin rules like a printed feature */
.p-magazine h1{font-weight:500;font-size:clamp(2.8rem,8vw,6rem);letter-spacing:-.035em;line-height:1}
.p-magazine h2{font-weight:500;font-style:italic;letter-spacing:-.02em}
.p-magazine .brand{font-family:var(--head);font-weight:700;font-size:1.35rem}
.p-magazine .nav a{font-size:.8rem;text-transform:uppercase;letter-spacing:.12em}
.p-magazine .hero{border-bottom:1px solid var(--rule)}.p-magazine .lede{font-family:var(--head);font-style:italic;font-size:clamp(1.3rem,2.4vw,1.6rem)}
.p-magazine .card{border-top:1px solid var(--ink);padding-top:1.1rem}.p-magazine .card h3{font-family:var(--head);font-style:italic;font-weight:500;font-size:1.5rem}
.p-magazine blockquote{font-style:italic;font-size:clamp(1.8rem,4vw,2.9rem);line-height:1.15}
.p-magazine .stat dd{font-weight:500}

@media(max-width:760px){.menu-button{display:block}
.nav{display:none;position:absolute;top:100%;left:0;right:0;flex-direction:column;gap:0;padding:.5rem 1.25rem 1rem;background:var(--background);border-bottom:1px solid var(--rule)}
.nav.open{display:flex}.nav a{padding:.7rem 0}.has-header .nav{background:var(--header-bg)}
.p-bulletin .masthead-inner{flex-direction:row;padding:1rem 0}.p-bulletin .brand{font-size:1.4rem}.p-bulletin .nav{border-block:0;margin:0;padding:.5rem 1.25rem 1rem;justify-content:flex-start}
.hero.has-art .hero-inner,.p-bulletin .hero.has-art .hero-inner,.contact-inner{grid-template-columns:1fr}
.p-grassroots .cards{border-width:3px}.p-grassroots .card{border-right:0;border-bottom:3px solid var(--ink)}.p-grassroots .card:last-child{border-bottom:0}
.p-bulletin .card{border-left:0;padding:1rem 0;border-top:1px solid var(--rule)}.p-bulletin .card:first-child{border-top:0}
.button{max-width:100%;overflow-wrap:anywhere}section{padding-block:calc(var(--rhythm) * .35)}}
`;

// Changes whenever SITE_CSS does, so a deploy never pairs new pages with a cached old stylesheet.
const CSS_VERSION = [...SITE_CSS].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7).toString(36);
