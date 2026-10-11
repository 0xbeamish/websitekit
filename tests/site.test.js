import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../src/schema.js";
import { renderSite } from "../src/site.js";
import { editorGroups, buildEditorForm } from "../src/editorform.js";
import { describeChanges } from "../src/ai.js";

const SITE = {
  name: "Riverside Tenants",
  theme: { preset: "warm" },
  colors: { primary: "#17324d", accent: "#f2b84b", background: "#f7f7f3" },
  sections: [
    { type: "hero", heading: "Fair rent for everyone", body: "We organize tenants." },
    { type: "text", heading: "About us", body: "First paragraph.\n\nSecond paragraph." },
    { type: "cards", heading: "What we do", items: [{ title: "Clinics", body: "Weekly." }, { title: "Repairs", body: "We push landlords." }] },
    { type: "contact", heading: "Get in touch", email: "hello@example.org" },
  ],
  pages: [
    { title: "Programs", slug: "programs", sections: [{ type: "hero", heading: "Programs" }, { type: "text", heading: "Clinics", body: "Every Tuesday." }, { type: "text", heading: "Repairs", body: "Every Thursday." }] },
    { title: "News", slug: "news", sections: [{ type: "hero", heading: "News", body: "Watch this space." }] },
  ],
};

// What a browser would submit for the editor's form HTML (no files, no submit button).
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function submit(cfg, slug = "", extra = {}, add = "") {
  const n = normalize(cfg);
  const form = editorGroups(n, { page: slug ? n.pages.find((p) => p.slug === slug) : null, add });
  const html = form.groups.map((g) => g.body).join("") + form.addRow;
  const fd = new FormData();
  for (const [, attrs] of html.matchAll(/<input ([^>]*)>/g)) {
    const name = attrs.match(/name="([^"]*)"/)?.[1], type = attrs.match(/type="([^"]*)"/)?.[1] || "text";
    if (!name || type === "file" || ((type === "radio" || type === "checkbox") && !/ checked/.test(attrs))) continue;
    fd.append(name, unescape(attrs.match(/value="([^"]*)"/)?.[1] ?? ""));
  }
  for (const [, name, value] of html.matchAll(/<textarea [^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/textarea>/g)) fd.append(name, unescape(value));
  for (const [, name, opts] of html.matchAll(/<select [^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g)) fd.append(name, (opts.match(/value="([^"]*)" selected/) || opts.match(/value="([^"]*)"/))[1]);
  fd.set("count", String(form.count));
  for (const [k, v] of Object.entries(extra)) v === null ? fd.delete(k) : fd.set(k, v);
  return buildEditorForm({}, "0000000000000000", fd, cfg, slug);
}
const page = (cfg, slug) => cfg.pages.find((p) => p.slug === slug);

test("normalize is stable and drops what the template can't show", () => {
  const n = normalize(SITE);
  assert.deepEqual(normalize(n), n);
  const junk = normalize({ ...SITE, sections: [...SITE.sections, { type: "script", body: "x" }, { type: "faq", items: [] }] });
  assert.equal(junk.sections.length, SITE.sections.length);
  assert.deepEqual(normalize({ ...SITE, pages: [{ title: "Edit", slug: "edit" }, { title: "Edit" }] }).pages.map((p) => p.slug), ["edit-page", "edit-page-2"]);
});

test("home and extra pages render with a page menu", () => {
  const home = renderSite(SITE);
  assert.match(home, /<a href="\/" aria-current="page">Home<\/a><a href="\/programs">Programs<\/a>/);
  assert.match(home, /class="actions"/); // home keeps its buttons by default
  const programs = renderSite(SITE, { page: "programs" });
  assert.match(programs, /<title>Programs · Riverside Tenants<\/title>/);
  assert.doesNotMatch(programs, /class="actions"/); // extra pages start without them
  assert.equal(renderSite(SITE, { page: "missing" }), null);
});

test("a site without pages keeps the scrolling menu", () => {
  const html = renderSite({ ...SITE, pages: [] });
  assert.match(html, /<a href="#text-1">About us<\/a>/);
});

test("saving the editor form without edits changes nothing", async () => {
  for (const slug of ["", "programs", "news"]) {
    const r = await submit(SITE, slug);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.config, normalize(SITE), `page ${slug || "home"}`);
  }
});

test("a message form saves without edits unchanged, and its wording can be edited", async () => {
  const withForm = { ...SITE, pages: [...SITE.pages, { title: "Join", slug: "join", sections: [{ type: "hero", heading: "Join" }, { type: "form", heading: "Write to us", thanks: "We’ll be in touch." }] }] };
  assert.deepEqual((await submit(withForm, "join")).config, normalize(withForm));
  const r = await submit(withForm, "join", { s1_button: "Send" });
  assert.equal(page(r.config, "join").sections[1].button, "Send");
});

test("every section is editable, movable and removable", async () => {
  let r = await submit(SITE, "programs", { s2_heading: "Repair help" });
  assert.equal(page(r.config, "programs").sections[2].heading, "Repair help");
  r = await submit(SITE, "programs", { op: "up:2" });
  assert.deepEqual(page(r.config, "programs").sections.map((s) => s.heading), ["Programs", "Repairs", "Clinics"]);
  r = await submit(SITE, "programs", { op: "up:1" }); // can't go above the top section
  assert.deepEqual(page(r.config, "programs").sections.map((s) => s.heading), ["Programs", "Clinics", "Repairs"]);
  r = await submit(SITE, "programs", { op: "remove:1", s2_body: "Edited too." });
  assert.deepEqual(page(r.config, "programs").sections.map((s) => s.body || ""), ["", "Edited too."]);
});

test("adding a section and items", async () => {
  const r = await submit(SITE, "", {}, "quote");
  assert.deepEqual(r.config, normalize(SITE)); // an empty new section isn't kept
  const filled = await submit(SITE, "", { s3_text: "We won.", s3_by: "A member" }, "quote"); // the new panel takes Contact's place, above it
  assert.deepEqual(filled.config.sections.map((s) => s.type), ["hero", "text", "cards", "quote", "contact"]); // contact stays last
  const card = await submit(SITE, "", { s2_it2_title: "Food bank", s2_it2_body: "Fridays." });
  assert.equal(card.config.sections[2].items.length, 3);
});

test("form errors keep what was typed", async () => {
  const r = await submit(SITE, "", { s3_email: "not-an-email" });
  assert.match(r.errors.join(" "), /Contact email/);
  assert.equal(r.raw.sections[3].email, "not-an-email");
  const clash = await submit(SITE, "news", { pageSlug: "programs" });
  assert.match(clash.errors.join(" "), /already uses/);
});

test("hero buttons can be turned off on home and on for a page", async () => {
  const off = await submit(SITE, "", { s0_buttons: null });
  assert.doesNotMatch(renderSite(off.config), /class="actions"/);
  const on = await submit(SITE, "programs", { s0_buttons: "1" });
  assert.match(renderSite(on.config, { page: "programs" }), /class="actions"/);
});

test("describeChanges names pages and sections in plain words", () => {
  const next = structuredClone(SITE);
  next.pages[1].sections[0].body = "Events soon.";
  next.sections[1].body = "New story.";
  assert.deepEqual(describeChanges(SITE, next), ["About", "“News” page"]);
});

test("header and footer colours are optional and keep text readable", async () => {
  assert.doesNotMatch(renderSite(SITE), /has-header|has-footer/); // off by default: the page background
  const r = await submit(SITE, "", { headerOn: "1", headerColor: "#111111", footerOn: "1", footerColor: "#f2f2f2" });
  const html = renderSite(r.config);
  assert.match(html, /class="p-warm has-header has-footer"/);
  assert.match(html, /--header-bg:#111111;--header-ink:#ffffff/);
  assert.match(html, /--footer-bg:#f2f2f2;--footer-ink:#16191d/);
});

test("one page can have its own spacing", async () => {
  const r = await submit(SITE, "news", { pageRhythm: "compact" });
  assert.match(renderSite(r.config, { page: "news" }), /--rhythm:4rem/);
  assert.match(renderSite(r.config), /--rhythm:8rem/); // home keeps the site's (Warm: spacious)
});

test("the new looks render with their own fonts", () => {
  for (const [preset, font] of [["modern", "family=Inter\\+Tight"], ["magazine", "family=Fraunces"]]) {
    const html = renderSite({ ...SITE, theme: { preset } });
    assert.match(html, new RegExp(`class="p-${preset}`));
    assert.match(html, new RegExp(font));
  }
});
