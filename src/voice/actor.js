// Discord does not identify the target of every move/disconnect audit entry.
// Those matches are explicitly marked as likely rather than confirmed actors.
function createVoiceActorResolver({ auditLogEvents, viewAuditLogPermission, wait }) {
  const usedEntries = new Map();
  const windowMs = 5_000;

  return async function resolveVoiceActor({ guild, memberId, action, channelId, change, occurredAt }) {
    if (!guild?.members?.me?.permissions?.has(viewAuditLogPermission)) {
      return 'Unknown (missing View Audit Log permission)';
    }
    if (typeof guild.fetchAuditLogs !== 'function') return 'Unknown (audit log unavailable)';

    for (const [key, used] of usedEntries) {
      if (used.expiresAt < occurredAt) usedEntries.delete(key);
    }
    const type = action === 'move' ? auditLogEvents.MemberMove
      : action === 'disconnect' ? auditLogEvents.MemberDisconnect : auditLogEvents.MemberUpdate;

    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt) await wait(750);
        const audit = await guild.fetchAuditLogs({ type, limit: 10 });
        const candidates = [];
        for (const entry of audit.entries.values()) {
          if (!entry.id || entry.action !== type || !Number.isFinite(entry.createdTimestamp)
            || Math.abs(entry.createdTimestamp - occurredAt) > windowMs) continue;

          const targetId = entry.targetId ?? entry.target?.id;
          if (targetId && targetId !== memberId) continue;
          if (action === 'move' && entry.extra?.channel?.id !== channelId) continue;
          if (change && (targetId !== memberId || !entry.changes?.some(item =>
            item.key === change.key && item.new === change.new
            && (item.old === undefined || item.old === change.old)))) continue;

          const count = change || targetId ? 1 : Number(entry.extra?.count);
          if (!Number.isSafeInteger(count) || count < 1) continue;
          const key = `${guild.id}:${entry.id}:${change?.key ?? action}`;
          if (count <= (usedEntries.get(key)?.count ?? 0)) continue;
          candidates.push({ entry, targetId, key, count });
        }

        if (candidates.length > 1) return 'Unknown (ambiguous audit logs)';
        if (candidates.length === 1) {
          const { entry, targetId, key } = candidates[0];
          const executorId = entry.executorId ?? entry.executor?.id;
          if (!executorId) return 'Unknown (audit log unavailable)';
          usedEntries.set(key, {
            count: (usedEntries.get(key)?.count ?? 0) + 1,
            expiresAt: entry.createdTimestamp + windowMs,
          });
          return `<@${executorId}>${targetId ? '' : ' (likely; audit log match)'}`;
        }
      }
    } catch {
      return 'Unknown (audit log unavailable)';
    }
    return change ? 'Unknown (no matching audit log)'
      : 'Unknown (self action or no matching audit log)';
  };
}

module.exports = { createVoiceActorResolver };
