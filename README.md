# Website Kit

Websites for community organizations — unions, tenant groups, mutual aid networks — that volunteers can run without a developer. One Cloudflare Worker hosts every site, each on the organization's own domain.

- **An editor anyone can use.** Organizations edit a private draft in plain forms, see a live preview, and press Publish. Every published version is kept and can be restored.
- **Pages, sections and themes.** A home page plus up to 8 extra pages, each built from sections (headline, text, cards, numbers, quote, questions, banner, contact). Four presets with font, corner, spacing and colour overrides; text colours adjust automatically to stay readable.
- **Teams.** Editors sign in with Google. Anyone on a site can add people; owners can remove them and can require that only they publish.
- **A built-in assistant.** Ask for changes in plain words, or attach a Word document of website copy and it builds the pages from it. It edits the draft only.
- **A connector for AI apps.** Claude, ChatGPT or any MCP client can connect, sign in with the same Google account, and read sites and change drafts. Publishing stays with people.

## How it works

| Piece | What it is |
|---|---|
| `src/index.js` | Routing. An org's domain serves its live site and `/edit`; the portal host serves sign-in, `/admin`, intake links and the connector. |
| `src/schema.js` | The single definition of a site's settings. Everything — forms, the assistant, the connector — goes through `normalize()`, so nothing outside these fields renders. |
| `src/site.js` | Renders a site page from its settings, with the shared stylesheet. |
| `src/editor.js`, `src/editorform.js` | The editor: one panel per section, pages, sharing, history, the assistant sidebar. |
| `src/ai.js` | The built-in assistant (Claude via the Anthropic API) with two tools, `get_draft` and `save_draft`. |
| `src/connector.js` | MCP server at `/mcp` with `list_sites`, `get_site`, `save_site`, behind OAuth 2.1 ([`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)). |
| `src/auth.js` | Google sign-in, sessions, editor lists. |
| `src/portal.js`, `src/admin.js` | Intake form for new organizations; the admin page. |
| `schema.sql` | The D1 (SQLite) database. |

Storage: D1 for sites, people and history; R2 for uploaded images; KV for the connector's OAuth grants.

## Run your own

You need a Cloudflare account (the free plan works), Node 20+, and a Google Cloud project for sign-in.

1. `npm install`, then `cp wrangler.example.jsonc wrangler.jsonc`.
2. Create the storage and put each id into `wrangler.jsonc`:
   ```sh
   npx wrangler d1 create websitekit
   npx wrangler r2 bucket create websitekit-media
   npx wrangler kv namespace create OAUTH_KV
   npx wrangler d1 execute websitekit --remote --file schema.sql
   ```
3. In Google Cloud, create an OAuth client (type: Web application) with the redirect URI `https://<your portal host>/auth/google/callback`. Put its client ID in `wrangler.jsonc` and its secret in Cloudflare:
   ```sh
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put ANTHROPIC_API_KEY   # for the built-in assistant
   npx wrangler secret put ADMIN_PASSWORD      # fallback admin login before Google is set up
   ```
4. Set `PORTAL_HOST`, `ADMIN_EMAILS`, `OPERATOR_NAME` and `OPERATOR_EMAIL`, then `npx wrangler deploy`.
5. Open `https://<portal host>/admin`, create an invite link, and send it to an organization. Their first submission creates the site; when it's ready, add their domain to `routes` in `wrangler.jsonc` and deploy.

### Local development

```sh
printf 'ADMIN_PASSWORD=dev\nANTHROPIC_API_KEY=...\n' > .dev.vars
npx wrangler d1 execute websitekit --local --file schema.sql
npx wrangler dev --local
```

Google sign-in needs a real host, so locally use admin sign-in links (`/admin` → a site → sign-in link).

## Connecting an AI app

Add `https://<portal host>/mcp` as a custom connector (an MCP server) in your AI app. It opens a consent page here, then Google sign-in; use the Google account you edit your website with. The app can then list your sites, read them and change drafts. You check the preview at `/edit` and publish.

Anyone removed from a site's editors loses access through their AI app at once, since access is checked on every call.

## Feature requests

When someone asks the assistant (or a connected AI app) for something the template can't do, it offers to pass the request on. With the person's agreement it opens a public GitHub issue — only the title and description, never the site or the person — that mentions `@claude`, and `.github/workflows/claude.yml` drafts a pull request. A maintainer reviews and merges; nothing deploys on its own. At most 5 issues are filed automatically per day; the rest wait on `/admin` to be sent by hand. Set `GITHUB_REPO`, the `GITHUB_TOKEN` secret (a fine-grained token with Issues: write), the Claude GitHub app and the repository's `ANTHROPIC_API_KEY` secret to turn this on.

## Contributing

Issues and pull requests are welcome. Keep the editor usable by a volunteer who has never seen it: plain words, no jargon, nothing that publishes without a person pressing Publish. Every new field goes through `normalize()` in `src/schema.js`.

## License

AGPL-3.0. You can use, change and run Website Kit, including for others; if you run a modified version as a service, share your changes under the same license. See [LICENSE](LICENSE).
