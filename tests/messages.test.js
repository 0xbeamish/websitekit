import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../src/schema.js";
import { renderSite } from "../src/site.js";
import { editorGroups } from "../src/editorform.js";
import { receiveMessage, messagesPanel, messagesPost, DAILY_PER_SITE } from "../src/messages.js";

const SITE = {
  name: "Riverside Tenants",
  sections: [{ type: "hero", heading: "Fair rent" }, { type: "text", body: "About us." }],
  pages: [{ title: "Get involved", slug: "get-involved", sections: [{ type: "hero", heading: "Get involved" }, { type: "form", heading: "Send us a message", body: "We reply within a week." }] }],
};

// Just enough of D1 for these queries: counts today's messages, keeps inserts, records deletes and updates.
function fakeEnv({ today = 0 } = {}) {
  const rows = [], runs = [];
  const DB = {
    prepare: (sql) => ({
      bind: (...args) => ({
        first: async () => (sql.includes("COUNT(*)") ? { n: today } : null),
        run: async () => { if (sql.startsWith("INSERT")) rows.push(args); else runs.push([sql, args]); return { meta: { changes: 1 } }; },
      }),
    }),
  };
  return { env: { DB }, rows, runs };
}
const site = { id: "0000000000000000", config: JSON.stringify(SITE) };
const formData = (fields) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, v); return fd; };
const good = { page: "get-involved", at: "form-1", name: "Sam", email: "sam@example.org", message: "I can help on Saturdays." };

test("a message form is a section like any other", () => {
  const n = normalize(SITE);
  assert.deepEqual(n.pages[0].sections[1], { type: "form", heading: "Send us a message", body: "We reply within a week.", button: "", thanks: "" });
  assert.deepEqual(normalize(n), n);
  assert.equal(normalize({ ...SITE, sections: [{ type: "hero" }, { type: "form", heading: "" }] }).sections.length, 1); // no heading, not shown
});

test("the form sends only on the live site; previews show it switched off", () => {
  const preview = renderSite(SITE, { page: "get-involved" });
  assert.match(preview, /<button class="button primary" disabled>Send message<\/button>/);
  assert.doesNotMatch(preview, /action=/);
  const live = renderSite(SITE, { page: "get-involved", form: { action: "/_kit/message" } });
  assert.match(live, /<form class="kit-form" method="post" action="\/_kit\/message">/);
  assert.match(live, /name="at" value="form-1"/);
  assert.match(live, /name="website" tabindex="-1"/); // the spam trap
  const sent = renderSite(SITE, { page: "get-involved", form: { action: "/_kit/message", at: "form-1", sent: true } });
  assert.match(sent, /Thanks — your message has been sent\./);
  assert.doesNotMatch(sent, /kit-form/);
  assert.match(renderSite(SITE), /href="\/get-involved">Get in touch</); // home's button finds the form's page
});

test("a sent message is stored for the editors", async () => {
  const { env, rows } = fakeEnv();
  assert.deepEqual(await receiveMessage(env, site, formData(good)), { slug: "get-involved", at: "form-1", sent: true });
  assert.deepEqual(rows, [[site.id, "Get involved", "Sam", "sam@example.org", "I can help on Saturdays."]]);
});

test("bad, spam and unknown messages aren't stored", async () => {
  const { env, rows } = fakeEnv();
  const bad = await receiveMessage(env, site, formData({ ...good, email: "sam at example" }));
  assert.match(bad.error, /email address/);
  assert.equal(bad.values.message, good.message); // what they typed comes back
  assert.match(renderSite(SITE, { page: "get-involved", form: { action: "/_kit/message", ...bad } }), /role="alert"[\s\S]*I can help on Saturdays\./);
  assert.match((await receiveMessage(env, site, formData({ ...good, message: " " }))).error, /fill in/);
  assert.equal((await receiveMessage(env, site, formData({ ...good, website: "http://spam" }))).sent, true); // looks sent to a bot
  assert.equal(await receiveMessage(env, site, formData({ ...good, at: "form-0" })), null); // that section isn't a form
  assert.equal(await receiveMessage(env, site, formData({ ...good, page: "missing" })), null);
  assert.deepEqual(rows, []);
  const full = fakeEnv({ today: DAILY_PER_SITE });
  assert.match((await receiveMessage(full.env, site, formData(good))).error, /lot of messages today/);
  assert.deepEqual(full.rows, []);
});

test("the editor lists messages safely and can delete them", async () => {
  const html = messagesPanel([{ id: 7, page: "Get involved", name: "<b>Sam</b>", email: "sam@example.org", message: "Hi <script>", read_at: null, created_at: "2026-10-11 10:00:00" }],
    { base: "/edit", siteName: "Riverside Tenants", ago: () => "just now" });
  assert.match(html, /1 new/);
  assert.match(html, /&lt;b&gt;Sam&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /href="mailto:sam@example.org\?subject=Your%20message%20to%20Riverside%20Tenants"/);
  assert.match(html, /action="\/edit\/messages\/7\/delete"/);
  const { env, runs } = fakeEnv();
  assert.deepEqual(await messagesPost(env, site, "messages/7/delete"), { done: "messageDeleted" });
  assert.deepEqual(runs[0][1], [7, site.id]); // only this site's message
  assert.equal(await messagesPost(env, site, "messages/x/delete"), null);
});

test("a new message form in the editor starts with a heading, so it's kept when saved", () => {
  const n = normalize(SITE);
  const { groups } = editorGroups(n, { page: n.pages[0], add: "form" });
  assert.match(groups.find((g) => g.id === "new").body, /value="Send us a message"/);
});
