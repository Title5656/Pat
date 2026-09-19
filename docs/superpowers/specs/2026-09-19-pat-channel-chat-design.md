# Pat Channel Chat Design

## Goal

ให้สมาชิกพิมพ์ข้อความปกติคุยกับ Pat ได้ทันทีใน Discord ห้องเดียวที่กำหนด โดย Pat ใช้ Gemini ตอบด้วยภาษาไทยและคาแรกเตอร์เอ๋อแบบน่ารัก

## User flow

1. สมาชิกส่งข้อความปกติในห้อง `PAT_CHAT_CHANNEL_ID`
2. Pat แสดงสถานะกำลังพิมพ์
3. ระบบรวม persona กับบทสนทนา 12 ข้อความล่าสุดของห้อง
4. ระบบส่งบริบทไปยัง Gemini GenerateContent API
5. Pat ส่งคำตอบสาธารณะในห้องเดิมโดยไม่ parse mentions
6. ระบบเก็บข้อความของสมาชิกและคำตอบที่สำเร็จลง memory

ไม่ต้องใช้ slash command การแท็ก หรือการ reply ข้อความจากห้องอื่น บัญชีบอท และข้อความว่างจะถูกละเว้น

## Character

Pat ใช้ภาษาไทยเป็นหลัก ตอบกระชับ เป็นกันเอง และมีความเอ๋อแบบน่ารักผ่านการเข้าใจช้าบ้าง สะดุดบ้าง หรือแก้คำพูดตัวเองเป็นครั้งคราว แต่ยังตอบสาระหลักให้ถูกต้อง ไม่ล้อเลียนผู้ใช้ และไม่แกล้งจำข้อมูลที่ไม่มีในประวัติ

## Architecture

- `index.js` สร้าง Discord client พร้อม `GuildMessages` และ `MessageContent` intents แล้วผูก `MessageCreate`
- `src/chat/handle-message.js` กรอง channel, bot และข้อความว่าง จากนั้นแสดง typing และส่งคำตอบ
- `src/chat/conversation.js` จัดคิวคำขอแยกตามห้อง รวม persona กับ history และบันทึกรอบที่สำเร็จ
- `src/chat/memory.js` เก็บสูงสุด 12 ข้อความต่อห้องในหน่วยความจำ
- `src/chat/gemini-client.js` แปลง history เป็นรูปแบบ `user`/`model` ของ Gemini SDK
- `src/chat/persona.js` เก็บ system instruction ของ Pat แยกจาก Discord และ Gemini adapter

## Configuration

ต้องกำหนด `DISCORD_TOKEN`, `VOICE_LOG_CHANNEL_ID`, `PAT_CHAT_CHANNEL_ID`, และ `GEMINI_API_KEY` ส่วน `GEMINI_MODEL` ใช้ `gemini-flash-latest` เป็นค่าเริ่มต้น ต้องเปิด Message Content Intent ใน Discord Developer Portal

## Failure and safety behavior

- ถ้า Gemini เรียกไม่สำเร็จ ให้ตอบ `แพทคิดไม่ออกอะ ลองถามใหม่อีกทีได้มั้ย 🫠`
- ไม่เก็บรอบที่ล้มเหลวลง memory
- ตัดคำตอบที่เกิน 2,000 ตัวอักษร
- ปิด mentions ในคำตอบทุกชนิด
- จัดคิวข้อความในห้องเดียวกันเพื่อรักษาลำดับบทสนทนา
- ระบบ voice logger เดิมยังทำงานเหมือนเดิม

## Testing

ใช้ `node:test` ทดสอบการกรองห้องและบัญชีบอท, typing, Gemini success/failure, response limit, memory isolation, concurrent messages, intent wiring และ voice logger regression โดยไม่เชื่อม Discord หรือ Gemini จริง

