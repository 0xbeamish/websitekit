# Working on Website Kit

Website Kit runs websites for community organizations. The people who edit them are volunteers, often not technical. Read README.md for the layout of the code.

## Rules that keep sites safe

- **Every site setting goes through `normalize()` in `src/schema.js`.** A new field is added there first, with a length limit and a default, so nothing a form, the assistant or a connected AI app sends can render unless the schema allows it.
- **Saving without edits must change nothing.** Existing sites' stored settings stay valid: give new fields a default that renders exactly as before (store `null` for "the default"), so live sites look the same after a deploy.
- **Changes land in the draft.** Only a person pressing Publish makes them live. Nothing an AI writes publishes.
- **Escape everything rendered** with `esc()` from `src/html.js`. Links go through the `link()` check in `src/schema.js`.
- **One worker serves every site.** A change is a change for all organizations; avoid anything specific to one of them.

## Where things go

- A new kind of section: the schema in `src/schema.js`, rendering in `src/site.js` (and CSS in `SITE_CSS`), form fields in `src/editorform.js`, the assistant's schema in `src/ai.js`, and the description in `templateGuide()` there, which the built-in assistant and the AI-app connector both read.
- Database changes: add them to `schema.sql` with `CREATE TABLE IF NOT EXISTS` / new columns with defaults, and say in the pull request which statement must be run on the live database.

## Words on screen

Write for a volunteer who has never seen the editor: plain words, short sentences, no jargon ("draft", "publish" and "page" are fine; "slug", "config", "schema" are not). Explain what a setting does in a one-line hint under it.

## Before you finish

- `npm test` passes, and new behaviour has a test in `tests/`.
- `node --check` passes on every file you touched.
- The pull request says what a volunteer will see, and anything the maintainer must do (a database change, a new secret).
