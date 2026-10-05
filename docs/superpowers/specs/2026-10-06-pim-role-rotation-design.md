# Pim daily personal roles

On branch `pim`, give every human member of the configured server a personal
role. Keep `Title`, `Pat`, and `Pim` fixed in that order above the personal
roles. Once each day at midnight Asia/Bangkok, move the top personal role to
the bottom of the queue. Bot accounts keep their existing roles.

The role feature is enabled by default on this branch; `PIM_ROLES_ENABLED=false`
disables it and its privileged Guild Members intent. `PIM_ROLE_GUILD_ID` can
select the server; otherwise use the server containing `VOICE_LOG_CHANNEL_ID`.
Other servers are outside the feature's scope.

Use a stable queue sorted by member ID, rotated by the Bangkok calendar day.
For unchanged membership, each next day moves exactly one member from top to
bottom. This calculation also catches up missed days and gives the same order
after a restart without storing the last rotation day. Membership changes recompute the
queue for the current members. Roles contain only the member's display name
(at most 100 characters), with no prefix or ID. A SQLite registry maps guild,
member and role IDs; default path `data/pim-roles.sqlite`, overridable with
`PIM_ROLE_DATABASE_PATH`. Preserve this file on a persistent disk in production.
Duplicate display names still have separate roles. Renaming a member while
the bot is offline retains that member's stored role identity on restart.

Create roles with zero added permissions, hoist enabled and mentions disabled.
Only role IDs in the registry belong to this feature. Restore
missing assignments, rename personal roles with changed display names, and
delete personal roles belonging to departed members. Refuse mutations if Pim
lacks Manage Roles, a personal role is not editable, or its permissions have
been changed. Check the role capacity before creating any missing roles.
Place the personal roles in the lowest consecutive hierarchy positions; other
roles retain their relative order, including Title, Pat and Pim.

Reconcile on ready, fresh shard connections, guild availability, owned role
updates/deletion, member joins/leaves/updates, and date changes checked every
minute. Initial provisioning runs in the background and returns a stoppable
runtime immediately. A single flight prevents overlapping role creation. Failed runs retry
on the next timer tick, disconnected clients wait, and shutdown removes timers
and listeners. Startup failure must leave chat, voice logging and research usable.

Verify with injected Discord API boundaries and a controlled clock: no duplicate
roles on restart, Bangkok midnight rollover, full queue wrap, joins/leaves,
capacity and permission failures, event concurrency, retry and shutdown, and
the existing bot suite. Live deployment and Discord portal settings are separate
from implementing the branch.
