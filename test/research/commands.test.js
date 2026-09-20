const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand } = require('../../src/research/commands');

test('channel-list questions are routed as metadata reads instead of text searches', () => {
  assert.deepEqual(parseCommand('เซิร์ฟเวอร์ Friends มีห้องไหนบ้าง'), {
    type: 'list-channels', serverName: 'Friends', relativeServer: false,
  });
  assert.deepEqual(parseCommand('server Work มี channel อะไรบ้าง'), {
    type: 'list-channels', serverName: 'Work', relativeServer: false,
  });
  assert.deepEqual(parseCommand('server นั้นมีห้องอะไรบ้าง'), {
    type: 'list-channels', serverName: null, relativeServer: true,
  });
});

test('room-message questions and continuations preserve a requested total larger than one page', () => {
  assert.deepEqual(parseCommand('ขอดู 200 ข้อความล่าสุดในห้อง general'), {
    type: 'read-messages', requested: 200, all: false,
    channelName: 'general', relativeChannel: false, serverName: null, relativeServer: false,
  });
  assert.deepEqual(parseCommand('ห้อง general มีแชทอะไรบ้าง'), {
    type: 'read-messages', requested: 50, all: false,
    channelName: 'general', relativeChannel: false, serverName: null, relativeServer: false,
  });
  assert.deepEqual(parseCommand('ดูข้อความทั้งหมดในห้อง general'), {
    type: 'read-messages', requested: Infinity, all: true,
    channelName: 'general', relativeChannel: false, serverName: null, relativeServer: false,
  });
  assert.deepEqual(parseCommand('ห้อง general มีข้อความอะไรบ้าง server Friends'), {
    type: 'read-messages', requested: 50, all: false,
    channelName: 'general', relativeChannel: false, serverName: 'Friends', relativeServer: false,
  });
  assert.deepEqual(parseCommand('ต่ออีก 100 ข้อความ'), { type: 'continue', additional: 100 });
  assert.deepEqual(parseCommand('ต่อ'), { type: 'continue', additional: 0 });
});

test('server mutations are refused while ordinary evidence questions remain searches', () => {
  for (const input of [
    'ลบแชทห้องนี้', 'ลบแขทห้องนี้', 'ช่วยลบห้อง general', 'delete channel general', 'แบนสมาชิกคนนี้',
    'เปลี่ยนชื่อห้อง general', 'ช่วยส่งข้อความไปห้อง general', 'remove channel general',
    'purge messages in channel general', 'ย้ายห้อง general', 'mute member Alice',
    'เพิ่ม role admin ให้ Alice', 'lock channel general', 'ปักหมุดข้อความนี้',
    'ตั้ง slowmode ห้อง general', 'เปลี่ยน permission ของ role moderator',
    'ลบห้อง general ยังไง', 'สร้างห้องใหม่อย่างไร', 'แบนสมาชิกคนนี้ยังไง',
    'ขอให้บอทลบห้อง general',
    'ลบห้อง bug', 'ลบข้อความ bug นี้', 'mute member bug',
    'ช่วยแก้ไขข้อความ bug นี้ยังไง', 'เปลี่ยน permission bug แก้ยังไง',
  ]) {
    assert.deepEqual(parseCommand(input), { type: 'forbidden-mutation' });
  }
  for (const input of [
    'ใครเคยพิมพ์คำว่า ลบห้องนี้',
    'Alice นัดกินข้าววันไหน',
    'แก้ไขบั๊ก login ยังไง',
    'สร้างระบบ deploy ไว้ว่าอะไร',
    'ใน server Friends ห้อง general มีปัญหา deploy อะไรบ้าง',
    'ในห้อง general ข้อความเกี่ยวกับ deploy บอกว่าอะไร',
    'ในห้อง general มีข้อความอะไรบ้างเกี่ยวกับ deploy',
    'แก้ไขบั๊กส่งข้อความในห้อง general ยังไง',
    'สร้างระบบ role assignment ไว้ว่าอะไร',
  ]) {
    assert.deepEqual(parseCommand(input), { type: 'search' });
  }
});
