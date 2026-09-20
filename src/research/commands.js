function isMutation(text) {
  const command = text.replace(/^(?:(?:ขอ|ช่วย|กรุณา|แพท|pat)\s*)*(?:(?:สั่ง)?ให้บอท\s*)?/i, '');

  const action = '(?:ลบ|แก้ไข|สร้าง|เปลี่ยน|ย้าย|เตะ|แบน|ปลดแบน|ส่ง|เพิ่ม|ลด|เอาออก|มอบ|ถอด|ปิด|เปิด|ล็อก|ปลดล็อก|ปักหมุด|ถอนหมุด|ระงับ|ปลดระงับ|ปิดเสียง|เปิดเสียง|ตั้ง|เคลียร์|ล้าง|เตือน|delete\\b|remove\\b|purge\\b|clear\\b|edit\\b|create\\b|rename\\b|change\\b|move\\b|kick\\b|ban\\b|unban\\b|send\\b|add\\b|assign\\b|grant\\b|revoke\\b|mute\\b|unmute\\b|deafen\\b|undeafen\\b|timeout\\b|lock\\b|unlock\\b|pin\\b|unpin\\b|set\\b|disconnect\\b|warn\\b)';
  const modifier = '(?:(?:ชื่อ|ทุก|ทั้งหมด|เก่า|old\\b|all\\b|the\\b)\\s*)?';
  const discordTarget = '(?:ข้อความ|แชท|แขท|ห้อง|เธรด|เซิร์ฟ|สมาชิก|ผู้ใช้|บทบาท|ยศ|สิทธิ์|เว็บฮุก|คำเชิญ|อีโมจิ|ชื่อเล่น|ไมค์|เสียง|messages?\\b|chat\\b|channels?\\b|threads?\\b|servers?\\b|guilds?\\b|members?\\b|users?\\b|roles?\\b|permissions?\\b|webhooks?\\b|invites?\\b|emojis?\\b|nicknames?\\b|slowmode\\b)';
  return new RegExp(`^${action}\\s*${modifier}${discordTarget}`, 'i').test(command);
}

function entity(value) {
  return value?.trim().replace(/^#/, '') || null;
}

function relative(value) {
  return /^(?:นั้น|นี้|เดิม)$/i.test(value ?? '');
}

function matchChannelList(text) {
  let match = text.match(/^(?:ใน\s*)?(?:เซิร์ฟเวอร์|เซิฟเวอร์|เซิร์ฟ|เซิฟ|server)\s*(.+?)\s*มี\s*(?:ห้อง|channels?)\s*(?:อะไร|ไหน)(?:บ้าง)?\s*$/i);
  if (!match) {
    match = text.match(/^(?:ขอ\s*)?(?:ดู|แสดง)?\s*รายชื่อ\s*(?:ห้อง|channels?)\s*(?:ใน|ของ)\s*(?:เซิร์ฟเวอร์|เซิฟเวอร์|เซิร์ฟ|เซิฟ|server)\s*(.+?)\s*$/i);
  }
  if (!match) return null;
  const raw = entity(match[1]);
  const isRelative = relative(raw);
  return { type: 'list-channels', serverName: isRelative ? null : raw, relativeServer: isRelative };
}

function matchMessageRead(text) {
  let match = text.match(/^(?:ขอ\s*)?(?:ดู|อ่าน|แสดง)\s*(?:(?:ทั้งหมด|\d{1,6})\s*)?(?:ข้อความ|แชท|chat)(?:ล่าสุด|ทั้งหมด)?\s*(?:ใน|จาก)\s*(?:ห้อง|channel)\s*(.+?)(?:\s+(?:ใน\s*)?(?:เซิร์ฟเวอร์|เซิฟเวอร์|เซิร์ฟ|เซิฟ|server)\s+(.+?))?\s*$/i);
  if (!match) {
    match = text.match(/^(?:ใน\s*)?(?:ห้อง|channel)\s*(.+?)\s*มี\s*(?:ข้อความ|แชท|chat)\s*(?:อะไร|ไหน)(?:บ้าง)?(?:\s+(?:ใน\s*)?(?:เซิร์ฟเวอร์|เซิฟเวอร์|เซิร์ฟ|เซิฟ|server)\s+(.+?))?\s*$/i);
  }
  if (!match) return null;
  const rawChannel = entity(match[1]);
  const rawServer = entity(match[2]);
  const relativeChannel = relative(rawChannel);
  const relativeServer = relative(rawServer);
  const all = /ทั้งหมด/i.test(text);
  const count = text.match(/(\d{1,6})\s*(?:ข้อความ|แชท|chat)/i);
  return {
    type: 'read-messages', requested: all ? Infinity : Number(count?.[1] ?? 50), all,
    channelName: relativeChannel ? null : rawChannel, relativeChannel,
    serverName: relativeServer ? null : rawServer, relativeServer,
  };
}

function parseCommand(input) {
  const text = String(input).normalize('NFKC').trim();
  const continuation = text.match(/^ต่อ(?:อีก)?(?:\s*(\d{1,6})\s*(?:ข้อความ|แชท|chat))?\s*$/i);
  if (continuation) return { type: 'continue', additional: Number(continuation[1] ?? 0) };
  if (isMutation(text)) return { type: 'forbidden-mutation' };
  return matchMessageRead(text) ?? matchChannelList(text) ?? { type: 'search' };
}

module.exports = { parseCommand };
