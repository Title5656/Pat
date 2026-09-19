# Independent Discord Research Bot Implementation Plan

**Goal:** Build a separately configured and deployed Discord bot that answers questions using messages across its accessible servers, without changing Pat.

**Architecture:** A standalone Node application maintains a persistent SQLite full-text index, synchronizes Discord history in resumable batches, and gives Gemini only relevant, freshly verified messages. A dedicated Q&A channel, explicit trusted-user allowlist, independent persona, and independent conversation memory separate it from Pat.

**Tech stack:** Node.js 24, discord.js 14.27, @google/genai 2.23, built-in node:sqlite and node:test.

## Constraints and accepted defaults

- All implementation files live in research-bot; no imports, environment loading, or runtime coupling to Pat.
- New Discord application/token, separate Gemini configuration, database and deployment.
- Read guild text/announcement channels and accessible public/private threads, including archived threads and forum posts. No DMs, attachment extraction, voice, or image OCR.
- History backfill is progressive and resumes after restart. Live edits/deletes update the index; retrieved messages are refreshed before use to handle offline edits/deletions.
- Only explicitly configured trusted user IDs may ask. The Q&A channel must be private to these users because responses are posted there. They may receive sources from any server the bot can read.
- Thai/English keyword retrieval uses Intl.Segmenter and SQLite FTS5, with Gemini generating additional search phrases. Search is bounded and not an exhaustive audit of every message.
- A missing token/channel/user configuration stops startup. Never reuse Pat's credentials automatically. Verify the expected Discord application identity.
- Q&A privacy is checked at startup, before processing a question, and before each output chunk: reject public/shared-role access and nonallowlisted member grants. Discord owners/administrators can inherently read private channels; document this.

## Tasks

- [x] Storage: write failing tests for Thai/English search, persistence, edits, deletion, metadata search and checkpoints; implement src/store.js.
- [x] Discord synchronization: write failing pagination/restart/access tests; implement src/discord-source.js and src/indexer.js with independent per-channel failures and resumable history/new-message cursors.
- [x] Answer flow: write failing tests for denied users, irrelevant channels, no evidence, stale sources, citations, limits and per-user memory; implement src/assistant.js and src/gemini.js.
- [x] Application: implement validated src/config.js, index.js event wiring, startup identity check, safe failures, health status and graceful shutdown; exercise configuration and handler boundaries with node:test.
- [x] Package/deployment: add standalone package manifest/lock, .env.example, Dockerfile and Thai README with credentials, permissions, persistent disk, progressive coverage and verification instructions.
- [x] Verification: run new tests, syntax checks and Pat regression tests; review isolation and report setup still needed for a real Discord/Gemini smoke test.

Run each new suite before implementation with `node --test research-bot/test/<name>.test.js`, then repeat after implementation. Final standalone validation: `npm ci`, `npm run check`, `npm test` from research-bot. Existing application validation: `npm run check` and `npm test` from the workspace root.

## Verification results (2026-09-19)

- Standalone dependency installation and repeatable `npm ci --offline --ignore-scripts --no-audit --no-fund --cache .npm-cache` succeeded. Both external dependencies resolve inside research-bot/node_modules.
- New application's syntax checks and all 28 tests passed.
- Pat's syntax checks and all 43 original tests (`node --test test/*.test.js` at the parent root) passed. Git diff confirmed no tracked original application files were modified.
- Independent review findings were reproduced with failing tests, fixed and reviewed: forged model-authored citations, deleted search hits masking live evidence, and Q&A privacy validation.
- An in-memory 5,000-message indexing probe improved from 2,537 ms to 218 ms after replacing full FTS ID scans with rowid lookups. This is a local diagnostic, not a production throughput guarantee.
- Real Discord/Gemini smoke testing and deployment require the new bot credentials, application/channel IDs and trusted-user allowlist. No existing Pat token was read or reused, no live bot was started, and the Docker image was not built in this session.
