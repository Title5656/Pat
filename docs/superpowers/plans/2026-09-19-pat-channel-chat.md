# Pat Channel Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้ Pat ตอบข้อความปกติด้วย Gemini เฉพาะใน Discord ห้องเดียวที่กำหนด

**Architecture:** `MessageCreate` ส่งข้อความผ่านตัวกรองห้องไปยัง conversation service ซึ่งจัดคิวและเก็บ history ใน memory จากนั้น Gemini adapter สร้างคำตอบและ message handler ส่งกลับโดยปิด mentions ระบบ voice logger เดิมอยู่ใน client เดียวกัน

**Tech Stack:** Node.js 24, CommonJS, discord.js v14, `@google/genai`, `node:test`

**Spec:** `docs/superpowers/specs/2026-09-19-pat-channel-chat-design.md`

## Global Constraints

- ตอบเฉพาะข้อความปกติใน `PAT_CHAT_CHANNEL_ID`
- ละเว้นห้องอื่น บัญชีบอท และข้อความว่าง
- เก็บ 12 ข้อความล่าสุดในหน่วยความจำและจัดคิวแยกตามห้อง
- ปิด mentions และจำกัดคำตอบไม่เกิน 2,000 ตัวอักษร
- ใช้ Gemini ผ่าน `@google/genai` และ persona ในโมดูลแยก
- voice logger และ test suite เดิมต้องไม่ถดถอย

---

### Task 1: Message handler

**Files:**
- Create: `src/chat/handle-message.js`
- Test: `test/chat-message.test.js`

**Interfaces:**
- Consumes: `conversation.reply({ channelId, userName, text }): Promise<string>`
- Produces: `createMessageHandler({ chatChannelId, conversation, logger }): (message) => Promise<void>`

- [ ] เขียน failing tests สำหรับข้อความในห้องที่กำหนด ห้องอื่น บัญชีบอท ข้อความว่าง Gemini failure และคำตอบเกินขีดจำกัด
- [ ] รัน `node --test test/chat-message.test.js` และยืนยันว่า fail เพราะยังไม่มี module
- [ ] สร้าง handler ที่กรองข้อความ เรียก `sendTyping()` และส่ง `{ content, allowedMentions: { parse: [] } }`
- [ ] รัน focused tests และยืนยันว่า 4 tests ผ่าน

### Task 2: Runtime integration

**Files:**
- Modify: `index.js`
- Modify: `test/voice-log.test.js`
- Delete: `src/chat/command.js`
- Delete: `src/chat/handle-pat.js`
- Delete: `test/chat-command.test.js`
- Delete: `test/pat-interaction.test.js`

**Interfaces:**
- Consumes: `createMessageHandler` from Task 1
- Produces: Discord client with `MessageCreate`, `GuildMessages`, and `MessageContent`

- [ ] เพิ่ม failing integration assertion สำหรับ message listener และ intent ทั้งสี่รายการ
- [ ] เปลี่ยน config จาก `DISCORD_GUILD_ID` เป็น `PAT_CHAT_CHANNEL_ID`
- [ ] ผูก handler กับ `Events.MessageCreate` และลบ interaction registration
- [ ] ลบ slash-command modules และ tests ที่ไม่ใช้งาน
- [ ] รัน `node --test test/voice-log.test.js` และยืนยันว่า voice regression กับ message integration ผ่าน

### Task 3: Configuration and documentation

**Files:**
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] เพิ่ม `PAT_CHAT_CHANNEL_ID` และเอา `DISCORD_GUILD_ID` ออกจากตัวอย่าง environment
- [ ] เปลี่ยน syntax check จาก slash modules ไปเป็น `handle-message.js`
- [ ] อธิบายการเปิด Message Content Intent และการจำกัดห้องใน README
- [ ] อัปเดต changelog ให้ตรงกับพฤติกรรมข้อความปกติ
- [ ] รัน `npm run check && npm test` และยืนยันว่าออกด้วยรหัส 0

