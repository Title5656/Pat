# Pat Slash Chat Design

## Goal

เพิ่มแชตบอทให้ Pat โดยสมาชิกเรียกผ่าน `/pat ข้อความ:<ข้อความ>` เท่านั้น บอทตอบเป็นข้อความสาธารณะในห้องเดิม มีบุคลิกเอ๋อแบบน่ารัก และจำบทสนทนาล่าสุดของแต่ละห้องระหว่างที่โปรเซสยังทำงาน

## User flow

1. สมาชิกเลือกคำสั่ง `/pat`
2. สมาชิกกรอกช่อง `ข้อความ` ซึ่งบังคับกรอกและยาวไม่เกิน 1,000 ตัวอักษร
3. Pat แสดงสถานะกำลังคิดด้วย `deferReply()`
4. ระบบรวม persona กับบทสนทนาล่าสุดของห้อง แล้วส่งให้ Gemini GenerateContent API
5. Pat ตอบแบบสาธารณะในห้องเดิม
6. ระบบบันทึกข้อความของสมาชิกและคำตอบของ Pat ลง memory ของห้องนั้น

ข้อความปกติ การแท็กบอท และ reply ข้อความของบอทจะไม่เรียกฟีเจอร์แชต

## Character

Pat ใช้ภาษาไทยเป็นหลัก ตอบกระชับ เป็นกันเอง และมีความเอ๋อแบบน่ารักผ่านการเข้าใจช้าบ้าง สะดุดบ้าง หรือแก้คำพูดตัวเองเป็นครั้งคราว แต่ยังต้องตอบสาระหลักให้ครบ บุคลิกต้องไม่ทำให้ข้อมูลสำคัญผิด ไม่ล้อเลียนผู้ใช้ และไม่แกล้งทำเป็นจำเรื่องที่ไม่มีในประวัติสนทนา

กติกาคาแรกเตอร์อยู่ใน `src/chat/persona.js` เพื่อแก้ได้โดยไม่แตะส่วน Discord หรือส่วนเรียกโมเดล

## Architecture

- `index.js` สร้าง Discord client, เริ่ม health check, ผูก voice logger เดิม และผูก slash interaction handler
- `src/chat/command.js` นิยามและลงทะเบียน `/pat` แบบ guild command เพื่อให้พร้อมใช้ทันทีในเซิร์ฟเวอร์ MVP
- `src/chat/handle-pat.js` ตรวจ interaction, defer, เรียก conversation service และตอบกลับ
- `src/chat/conversation.js` สร้าง input ของโมเดลและอัปเดต memory เมื่อได้คำตอบสำเร็จ
- `src/chat/memory.js` เก็บสูงสุด 12 ข้อความต่อห้องในหน่วยความจำ
- `src/chat/gemini-client.js` เป็นขอบเขตเดียวที่รู้จัก Google Gen AI SDK
- `src/chat/persona.js` ส่งออก system instructions ของ Pat

## Configuration

ค่าที่ต้องมีเพิ่มคือ `DISCORD_GUILD_ID`, `GEMINI_API_KEY`, และ `GEMINI_MODEL` ส่วน `DISCORD_TOKEN` กับ `VOICE_LOG_CHANNEL_ID` ยังคงใช้เหมือนเดิม ตัวโปรแกรมหยุดเริ่มงานพร้อมข้อความชัดเจนเมื่อค่าที่จำเป็นสำหรับแชตหายไป

## Failure behavior

- ถ้าโมเดลตอบช้าหรือเรียก API ไม่สำเร็จ ให้แก้ deferred reply เป็น `แพทคิดไม่ออกอะ ลองถามใหม่อีกทีได้มั้ย 🫠`
- ไม่เก็บข้อความรอบที่เรียก API ล้มเหลวลง memory
- ตัดคำตอบที่เกินขีดจำกัดข้อความ Discord ก่อนส่ง
- interaction ที่ไม่ใช่ `/pat` ถูกละเว้น

## Testing

ใช้ `node:test` และ dependency injection เพื่อทดสอบ command definition, memory limit, การประกอบ prompt, success path, failure path และการละเว้น interaction อื่น โดยไม่เชื่อม Discord หรือ Gemini จริง จากนั้นรัน syntax check และ test suite เดิมทั้งหมดเพื่อยืนยันว่า voice logger ไม่ถดถอย

