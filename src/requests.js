import { logActivity } from "./editor.js";

// Feature requests: what people ask for that the template can't do. The assistant (or a connected AI app)
// records one when the person agrees; an admin reads it at /admin and may send it to GitHub, where an
// issue that mentions @claude gets a drafted pull request. Nothing reaches GitHub without the admin.

const OPEN_PER_SITE = 10; // unreviewed requests a site can have waiting

export async function saveRequest(env, { siteId, editorId, via, title, details }) {
  title = String(title || "").trim().slice(0, 120);
  details = String(details || "").trim().slice(0, 3000);
  if (!title || !details) return "A request needs a short title and a description of what's wanted.";
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM feature_requests WHERE site_id = ? AND status = 'new'").bind(siteId).first();
  if (open.n >= OPEN_PER_SITE) return `This site already has ${OPEN_PER_SITE} requests waiting for review, so this one wasn't added. Try again once those have been looked at.`;
  await env.DB.prepare("INSERT INTO feature_requests (site_id, editor_id, via, title, details) VALUES (?, ?, ?, ?, ?)")
    .bind(siteId, editorId || null, String(via).slice(0, 80), title, details).run();
  await logActivity(env, siteId, editorId || null, "suggested", title);
  return "Passed on to the people who look after Website Kit. They read every request and decide what gets built; it isn't guaranteed or immediate.";
}

export const githubReady = (env) => Boolean(env.GITHUB_TOKEN && env.GITHUB_REPO);

// The issue text an admin starts from; they edit it (and remove anything identifying) before sending.
export const defaultIssueBody = (r) => `@claude Please implement this feature request as a pull request. Follow CLAUDE.md.

**What a volunteer asked for** (through ${r.via})

${r.details}`;

export async function sendToGitHub(env, id, title, body) {
  const r = await env.DB.prepare("SELECT id FROM feature_requests WHERE id = ? AND status = 'new'").bind(id).first();
  if (!r) return { error: "That request was already handled." };
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "websitekit", "x-github-api-version": "2022-11-28" },
    body: JSON.stringify({ title: String(title).slice(0, 200), body: String(body).slice(0, 60000), labels: ["feature request"] }),
  });
  if (!res.ok) { console.error("github issue", res.status, await res.text()); return { error: `GitHub refused the issue (HTTP ${res.status}). Check the GITHUB_TOKEN secret has Issues: write on ${env.GITHUB_REPO}.` }; }
  const issue = await res.json();
  await env.DB.prepare("UPDATE feature_requests SET status = 'sent', issue_url = ? WHERE id = ?").bind(issue.html_url, id).run();
  return { url: issue.html_url };
}
