# Pim YouTube music

Approved interaction: Pim joins the requesting user's voice channel, accepts a YouTube link or song name through `/play`, plays a per-server queue, exposes `/queue`, `/skip`, and `/stop`, and disconnects when idle. The user approved this scope on 2026-10-08 and instructed implementation to proceed.

## Runtime

Use the existing Discord client and Node.js 24 process. Add `@discordjs/voice` with DAVE support, `opusscript`, `ffmpeg-static`, and an official, checksum-verified yt-dlp executable installed at build time. No second bot or music server. yt-dlp uses the existing Node runtime for YouTube JavaScript challenges. Audio passes through pipes and is never retained as song files.

## User behavior

- Register guild slash commands individually without replacing other application commands.
- Music commands and playback announcements use `PAT_STOPWATCH_CHANNEL_ID` only. Register commands in that channel's guild and reply privately when invoked elsewhere. Missing/invalid channel configuration disables only music.
- `/play query:<link or title>` fetches a fresh guild member and requires an ordinary voice channel with View Channel, Connect, and Speak permissions for Pim. Search takes the first YouTube result. A link plays one video even if it includes a playlist.
- One session per server; simultaneous requests preserve request order. A user in another voice channel cannot move or control an active session.
- `/queue` shows the current song and up to 10 pending songs. The waiting queue is limited to 25 songs, including pending lookups.
- `/skip` cancels the current song and starts the next one. `/stop` immediately clears the queue, cancels outstanding work, and leaves the room.
- Leave after 60 seconds with no queued/current song or no human listeners. A disconnected or moved bot releases its stream and queue.
- Public, non-live videos only; report unavailable/private/age-restricted/blocked tracks clearly. Song titles cannot trigger mentions or break Discord formatting.

## Boundaries and failures

`src/music/source.js` validates YouTube input and owns yt-dlp/FFmpeg processes. `src/music/player.js` owns session and queue state. `src/music/feature.js` owns Discord commands, permissions, events, and lifecycle. Startup failures remain isolated from chat, roles, research, and voice logs. `PIM_MUSIC_ENABLED=false` disables music; optional executable paths permit host-managed installations. Defaults use project-local yt-dlp and ffmpeg-static.

Stop, skip, startup timeouts, extractor failures, audio errors, empty-room timers, disconnects, and shutdown must all cancel the associated subprocesses and invalidate late asynchronous results. Only short error codes enter logs; tokens, process environments, extractor stderr, and signed stream URLs are excluded.

## Delivery and verification

Add build-time executable setup to package installation and deployment instructions to README. Run meaningful tests for queue order, independent servers, permission failures, cancellation races, extraction validation, subprocess cleanup, command preservation, and startup/shutdown integration, then the full existing suite and syntax checks. Verify installed voice/DAVE/Opus/FFmpeg dependencies and attempt real public YouTube extraction/audio decoding. Local tests do not prove playback on the deployed bot: Discord voice and hosting-network checks must be reported separately.

## Source checks

- Discord voice/DAVE requirements: https://discord.com/developers/docs/topics/voice-connections
- Voice library dependencies: https://discordjs.dev/docs/packages/voice/main
- yt-dlp installation and JavaScript support: https://github.com/yt-dlp/yt-dlp and https://github.com/yt-dlp/yt-dlp/wiki/EJS
