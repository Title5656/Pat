# Pim YouTube Music Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task with test-first verification.

**Goal:** Let Pim join a user's voice channel and play YouTube songs through slash commands.

**Architecture:** Keep one cancellable playback session per guild on the existing Discord client. Separate extraction/process ownership, queue state, and Discord integration.

**Tech Stack:** Node.js 24, discord.js, @discordjs/voice, yt-dlp, FFmpeg, opusscript, node:test.

**Spec:** ../specs/2026-10-08-pim-youtube-music-design.md

## Global Constraints

- Existing bot features stay available when music fails or is disabled.
- Waiting queue capacity: 25; idle and empty-room timeout: 60 seconds.
- Voice control requires membership in the session's ordinary voice channel.
- Commands and playback announcements are restricted to `PAT_STOPWATCH_CHANNEL_ID` and its guild.
- Audio is streamed through pipes; no persistent song files or credentials.
- Use current voice/DAVE support and an official checksum-verified yt-dlp release.

## Review Focus

- Stop/skip during a lookup or stream startup must not resurrect playback.
- Concurrent requests and errors must preserve queue order and continue to the next playable track.
- Moves, kicks, empty rooms, and shutdown must terminate subprocesses and timers.
- Command registration must preserve existing commands and fail independently per guild.
- Untrusted URLs/titles and extractor errors must not expose credentials or produce mentions.

### Task 1: YouTube source and executable setup

**Files:** `src/music/source.js`, `scripts/setup-music.js`, `test/music-source.test.js`, `package.json`, `package-lock.json`, `.gitignore`.

**Interfaces:** `createYouTubeSource().resolve(query, { signal })` returns `{ title, url, duration }`; `.open(track, { signal })` returns `{ stream, close }` with raw 48 kHz stereo PCM.

- [x] Write failing tests for URL canonicalization, shell-safe search arguments, malformed metadata, cancellation, and subprocess cleanup.
- [x] Run `node --test test/music-source.test.js`; confirm missing behavior fails.
- [x] Implement source and checksum-verified executable installer; install dependencies.
- [x] Run source tests and real extraction/decoding.

### Task 2: Per-guild playback

**Files:** `src/music/player.js`, `test/music-player.test.js`.

**Interfaces:** `createMusicManager({ source, voice })` exposes `enqueue`, `queue`, `skip`, `stop`, `voiceStateUpdate`, and `shutdown`. Consumes Task 1's source contract.

- [x] Write failing tests for FIFO playback, guild isolation, capacity, other-room rejection, idle/empty-room disconnect, and late-result cancellation.
- [x] Run `node --test test/music-player.test.js`; confirm missing behavior fails.
- [x] Implement queue/session ownership and cleanup.
- [x] Run queue tests and the existing suite.

### Task 3: Commands and deployment integration

**Files:** `src/music/feature.js`, `index.js`, `test/music-feature.test.js`, `test/voice-log.test.js`, `.env.example`, `README.md`, `CHANGELOG.md`.

**Interfaces:** `startMusic({ client })` registers owned guild commands and returns `{ stop }`; consumes Task 2's manager.

- [x] Write failing tests for channel/member permissions, command preservation, defer/reply behavior, startup failure isolation, and graceful shutdown.
- [x] Run feature and integration tests; confirm missing behavior fails.
- [x] Implement slash commands and lifecycle; document installation and use.
- [x] Run `npm test`, `npm run check`, `git diff --check`, dependency diagnostics, and review the whole diff.

## Execution record

User instruction: implement the approved scope in this chat. Existing checkout is clean on feature branch `pim`; keep the work reviewable here. Deployment requires the final code and current service configuration to be verified first.

Verified on 2026-10-08:
- Full suite: 218 tests passed, 0 failures. Syntax and whitespace checks passed.
- Fresh `npm ci` in an isolated temporary directory installed voice 0.19.2, DAVE, Opus, FFmpeg, and checksum-verified yt-dlp 2026.08.19.
- Real YouTube URL and title search for public video `jNQXAC9IVRw` succeeded. Audio decoded and encoded into 950 Opus packets, covering its full 19 seconds. Historical fixture `BaW_jenozKc` is unavailable; no failure was concealed.
- Review regressions fixed: failed metadata frees queue capacity; long escaped titles fit Discord's message limit; plays reserve order before Discord REST; stops cancel earlier preflight plays; later plays wait for earlier controls; cancellation watermark stays monotonic; moved users use their current voice room.
- Live Discord voice, DAVE negotiation, audible playback, and production host networking require deployment verification. No credentials were added to the repository.
- Independent final review: 35 music tests passed; no remaining Critical, Important, or Minor findings. The three-command race now produces stop, stop, cancelled play without revived playback.
