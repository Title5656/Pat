# Pim backoffice API

`GET /admin/overview` returns current bot, server, channel, personal-role, music-queue, and non-secret configuration data. It is read-only and runs on the existing Render HTTP listener.

Set the same strong random `PIM_ADMIN_API_KEY` on the Render bot and the Vercel backoffice server. Requests require `Authorization: Bearer <key>`. The browser only uses the same-origin Vercel API and its existing TiDB-backed account session; the shared key must never be a `VITE_` variable or client asset.

Missing keys disable the route with 503. Missing/wrong authorization returns 401, writes return 405, unknown admin paths return 404, and unavailable snapshots return a generic 503. Responses are not cached. Health/readiness routes and Discord commands continue through their existing paths.

The bridge publishes existing state. It does not implement role edits, settings changes, or music controls. Use Discord `/play`, `/queue`, `/skip`, and `/stop` for playback control.
