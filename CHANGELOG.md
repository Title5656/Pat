# Changelog

## Unreleased

- Integrate cross-server research as a second room on the existing Pat bot, sharing its Discord connection, Gemini key, and deployment while keeping persona and question memory separate.
- Add optional `PAT_RESEARCH_CHANNEL_ID`, persistent SQLite search, live source verification, and cited answers; access follows the private Discord channel permissions.
- Route room-list and room-history questions to read-only Discord operations, paginate histories in batches of 50, and add per-user `!reset` recovery without exposing server mutation operations.
- Remove the separate research-bot application and deployment setup; preserve existing chat/image and voice-log behavior when research is disabled or fails to initialize.

- Show a sanitized Gemini error with fallback replies while keeping full errors in server logs.
- Report Gemini safety blocks explicitly and redact credentials from public error details.
- Add a Gemini-backed chat channel where Pat answers normal messages with a Thai character prompt.
- Restrict chat responses to `PAT_CHAT_CHANNEL_ID` and ignore other channels and bot messages.
- Keep the latest 12 conversation messages in memory per Discord channel.
- Return a friendly fallback when Gemini fails and preserve the existing voice logger.
- Update bot branding, package metadata, and repository documentation to Pat (แพท).
- Configure the Render keepalive URL through the `RENDER_SERVICE_URL` repository Actions variable.
- Align package and lockfile metadata at version 0.1.0; keep dependency versions unchanged.
- Declare Node.js 24 support and mark the bot package as private.
- Check that the log channel is sendable and remove unreachable channel-name fallbacks.
- Add syntax checking and voice event regression tests using the built-in Node.js test runner.
- Run syntax checks and tests in CI for pushes and pull requests, without Discord credentials.
- Add manual CI runs, cancel superseded runs, pin official actions to commits, and document the required `Bot checks` branch protection check.
- Correct README links, remove unsupported claims and the license badge, and document checks.

## 0.1.0

- Log Discord voice joins and leaves with channel and member mentions.
- Ignore channel moves, status changes, bot accounts, and events without members.
- Format logs with blockquotes and spacing; catch channel lookup and message errors.
- Add setup and troubleshooting documentation.
- Add Render health endpoint support and a GitHub Actions keepalive schedule, later changed from five to ten minutes.
