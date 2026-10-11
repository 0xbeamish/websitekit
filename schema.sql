-- One row per organization website. config holds everything the template renders.
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,                -- random; also the preview URL key
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'live', 'archived')),
  domain TEXT,                        -- apex domain served once live, e.g. example.org
  config TEXT NOT NULL,               -- JSON; what the public site shows
  draft TEXT,                         -- JSON; what editors are working on (NULL = same as config)
  draft_rev INTEGER NOT NULL DEFAULT 0, -- bumped on every draft save, so stale saves are refused
  publish_policy TEXT NOT NULL DEFAULT 'anyone' CHECK (publish_policy IN ('anyone', 'owner')),
  submitter_name TEXT,
  submitter_email TEXT,
  invite_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS sites_domain ON sites(domain) WHERE domain IS NOT NULL;

-- Invite links: one submission each. Re-using a code edits the same pending site.
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  label TEXT,                         -- who it was sent to
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  site_id TEXT REFERENCES sites(id)
);

-- One row per "describe what you want" edit: the prompt, Claude's reply, and the config before, for undo.
CREATE TABLE IF NOT EXISTS ai_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id),
  prompt TEXT NOT NULL,
  reply TEXT,
  before_config TEXT NOT NULL,        -- JSON
  undone INTEGER NOT NULL DEFAULT 0,
  after_rev INTEGER,                  -- draft_rev this edit produced; undo only while the draft is still at it
  editor_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ai_edits_site ON ai_edits(site_id, created_at);

-- People who can edit a site, identified by email (they sign in with Google).
CREATE TABLE IF NOT EXISTS editors (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  name TEXT,
  email TEXT NOT NULL,                -- stored lowercase
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor')),
  is_admin INTEGER NOT NULL DEFAULT 0, -- a Website Kit admin's row: has owner powers, can't be removed by the org
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS editors_site ON editors(site_id);
CREATE UNIQUE INDEX IF NOT EXISTS editors_site_email ON editors(site_id, email) WHERE revoked_at IS NULL;

-- Signed-in browsers. The cookie holds the token; only its SHA-256 is stored. Removing an editor ends their sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  editor_id TEXT NOT NULL REFERENCES editors(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Short-lived codes that turn into a session on the site's own domain: after Google sign-in on the
-- portal ('google', one use, minutes), or a fallback link made in admin ('link', reusable for 7 days).
CREATE TABLE IF NOT EXISTS handoffs (
  code_hash TEXT PRIMARY KEY,
  editor_id TEXT NOT NULL REFERENCES editors(id),
  kind TEXT NOT NULL CHECK (kind IN ('google', 'link')),
  expires_at TEXT NOT NULL
);

-- Google sign-in in progress: the OAuth state, which site, and where to send the person back.
CREATE TABLE IF NOT EXISTS login_states (
  state TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  return_origin TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every publish, so any earlier version can be copied back into the draft.
CREATE TABLE IF NOT EXISTS site_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id),
  config TEXT NOT NULL,
  editor_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS site_versions_site ON site_versions(site_id, id);

-- Signed-in Website Kit admins (people in ADMIN_EMAILS), on the portal host.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- The shared assistant conversation for each site. 'changed' lists the parts of the page an assistant reply edited.
CREATE TABLE IF NOT EXISTS agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id),
  editor_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  changed TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS agent_messages_site ON agent_messages(site_id, id);

-- Who did what on a site: saves (with the parts changed), publishes, assistant edits, people added or removed.
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id),
  editor_id TEXT,
  kind TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS activity_site ON activity(site_id, id);

-- Things people asked for that the template can't do yet. An admin reviews each one and can send it to
-- GitHub as an issue, where Claude drafts the change as a pull request (.github/workflows/claude.yml).
CREATE TABLE IF NOT EXISTS feature_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id),
  editor_id TEXT REFERENCES editors(id),
  via TEXT NOT NULL, -- "the website assistant", or the connected AI app's name
  title TEXT NOT NULL,
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'sent', 'dismissed')),
  issue_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS feature_requests_status ON feature_requests (status, id);
