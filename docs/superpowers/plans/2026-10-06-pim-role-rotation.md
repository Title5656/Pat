# Pim Daily Roles Implementation Plan

> Execute inline with the test-driven-development and verification-before-completion workflows.

**Goal:** Personal roles for every human member, rotating top to bottom daily under fixed Title, Pat and Pim roles.

**Architecture:** A focused `src/roles/rotation.js` module owns role reconciliation and scheduling; `src/roles/store.js` persists ownership independently of clean display-name role labels. Bootstrap it on the existing Discord client and include it in shutdown. Compute the order from member IDs and the Bangkok day for repeatable daily cycling.

**Tech Stack:** Node 24, CommonJS, discord.js 14, node:test; no new packages.

**Spec:** `docs/superpowers/specs/2026-10-06-pim-role-rotation-design.md`

## Global Constraints

- Scope to PIM_ROLE_GUILD_ID or the voice log server, never all connected servers.
- Keep Title, Pat, Pim above the personal queue; no added role permissions.
- Enabled by default on pim; PIM_ROLES_ENABLED=false disables Guild Members intent.
- Midnight Asia/Bangkok; stable daily order across restarts and missed days.
- Role names contain only the friend's display name; preserve PIM_ROLE_DATABASE_PATH on a persistent disk.

## Review Focus

- Membership changes and duplicate display names must retain distinct personal roles.
- Missing permissions, modified personal roles and full role capacity must fail safely.
- Concurrent events and partial API failures must not create duplicate roles.
- Reconnects and restarts must catch up without extra daily rotation.
- Research-disabled and research-failed startup must still run and stop the role feature.

## Task 1: Personal role reconciliation and daily scheduler

- [x] Write behavioral tests in `test/role-rotation.test.js` for creation, daily cycling, restart recovery, fixed hierarchy, scope, joins, leaves, failures and shutdown.
- [x] Run `node --test test/role-rotation.test.js`; expect missing implementation failures.
- [x] Implement `src/roles/rotation.js` and rerun the focused tests; expect all pass.

## Task 2: Bot integration and configuration

- [x] Extend bootstrap tests for default activation, disabled intent, role startup failure isolation and stopping without research.
- [x] Run the integration tests; expect the new behavior to fail.
- [x] Wire roles and shutdown in `index.js`; update `.env.example`, README, changelog and `npm run check`.
- [x] Run `npm run check` and `npm test`; expect syntax checks and the entire suite to pass (179 tests).
- [x] Review the final diff for the five failure classes above and confirm branch `pim`.

Review fixes verified RED→GREEN: same-day fresh connections, deleted personal
roles, and slow initial provisioning. Updated user requirement: name-only role
labels with persisted role IDs, including a restart after an offline nickname change.
