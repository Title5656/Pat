# Changelog

## Unreleased

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
