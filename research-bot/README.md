# Discord Research Bot

บอทใหม่สำหรับถามตอบโดยค้นข้อความจาก Discord หลายเซิร์ฟเวอร์ **แยกจาก Pat เดิม** ทั้ง Discord application/token, persona, memory, SQLite และ process ที่ deploy ไม่มีการ import โค้ด อ่าน `.env` หรือเรียกใช้ระบบ voice log ของ Pat

โฟลเดอร์นี้เป็นโปรเจกต์ที่ย้ายไป repository ของตัวเองได้ ชื่อ Research Bot เป็นชื่อชั่วคราว เปลี่ยนชื่อที่ Discord Developer Portal และปรับบุคลิกใน `src/persona.js` ได้

## สิ่งที่ทำได้

- พิมพ์ถามในห้องที่กำหนด ไม่ต้องใช้ slash command หรือแท็กบอท
- ค้นข้อความไทย/อังกฤษ รวมชื่อผู้พูด ห้อง เซิร์ฟเวอร์ และวันที่ จากทุก guild text/announcement channel ที่บอทอ่านได้
- รวม active/archived public threads, private threads ที่ API อนุญาต และโพสต์ใน forum/media channel
- สรุปด้วย Gemini พร้อมเลขอ้างอิง ชื่อเซิร์ฟเวอร์ ห้อง ผู้พูด เวลาไทย และลิงก์ข้อความจริง
- ตอบอย่างตรงประเด็น ไม่ใช้ persona เอ๋อ/กวนของ Pat เดิม และแจ้งเมื่อหลักฐานไม่พอ
- เก็บดัชนีข้อความใน SQLite แบบ persistent; เก็บบริบทคำถาม 6 ข้อล่าสุดแยกตามผู้ถามในหน่วยความจำ
- ดึงประวัติเป็นหน้าและบันทึกตำแหน่งเพื่อทำต่อหลัง restart; รับข้อความใหม่ การแก้ไขและการลบระหว่างออนไลน์
- ตรวจข้อความต้นทางกับ Discord ซ้ำก่อนส่งให้ Gemini เพื่อไม่ใช้อ้างอิงที่ถูกลบหรือหมดสิทธิ์อ่าน

## ตั้งค่าบอทใหม่

1. สร้าง **Application ใหม่** ใน [Discord Developer Portal](https://discord.com/developers/applications) แล้วใช้ token ของบอทใหม่นี้เท่านั้น คัดลอก Application ID ด้วย
2. เปิด **Message Content Intent** ในหน้า Bot
3. เชิญบอทใหม่เข้าแต่ละเซิร์ฟเวอร์ที่ต้องการค้น ให้สิทธิ์ `View Channel` และ `Read Message History` ในห้องต้นทาง และ `Send Messages` ในห้องถามตอบ ไม่ต้องให้ Administrator หรือสิทธิ์จัดการข้อความ
4. สร้างห้องถามตอบแบบ private: ปิด `View Channel` ของ `@everyone` และ role ทั่วไป แล้วเพิ่มสิทธิ์ดูห้องให้บอทใหม่และสมาชิกใน allowlist เป็นรายคน อย่าใช้ shared role เพื่อเปิดให้สมาชิกกลุ่มหนึ่งอ่าน บอทจะตรวจสิทธิ์ตอนเริ่ม ก่อนประมวลผลคำถาม และก่อนส่งข้อความแต่ละส่วน หากมีสิทธิ์เปิดกว้างกว่านี้จะไม่ตอบ ทั้งนี้เจ้าของเซิร์ฟเวอร์และผู้มีสิทธิ์ Administrator ยังดูห้องได้ตามระบบของ Discord จึงควรสร้างห้อง Q&A ในเซิร์ฟเวอร์ที่คุณไว้ใจผู้ดูแลด้วย
5. คัดลอก `.env.example` เป็น `.env` **ภายในโฟลเดอร์นี้** แล้วกรอกค่าต่อไปนี้ ไม่ต้องส่ง token ในแชต

| ตัวแปร | ความหมาย |
| --- | --- |
| `RESEARCH_DISCORD_TOKEN` | Token ของ Discord bot ใหม่ |
| `RESEARCH_APPLICATION_ID` | Application ID ใหม่ ต้องตรงกับตัวบอทที่ login |
| `RESEARCH_QA_CHANNEL_ID` | ID ของห้องถามตอบแบบ text channel |
| `RESEARCH_ALLOWED_USER_IDS` | Discord user ID ของผู้ใช้ที่ไว้ใจ คั่นด้วย comma; ห้ามว่าง |
| `RESEARCH_GEMINI_API_KEY` | Gemini API key ที่ตั้งค่าสำหรับโปรเจกต์นี้ |
| `RESEARCH_GEMINI_MODEL` | ค่าเริ่มต้น `gemini-flash-latest`; เปลี่ยนเป็นโมเดลที่บัญชีคุณรองรับ |
| `RESEARCH_DATABASE_PATH` | ค่าเริ่มต้น `data/messages.sqlite`; path สัมพัทธ์นับจากโฟลเดอร์นี้ |
| `RESEARCH_SYNC_INTERVAL_SECONDS` | เว้นระหว่างรอบซิงก์ ค่าเริ่มต้น 60 วินาที |
| `RESEARCH_PAGES_PER_CHANNEL` | จำนวนหน้าต่อห้องต่อรอบ ในแต่ละทิศทางย้อนหลัง/ตามข้อความใหม่ ค่าเริ่มต้น 3 หน้า หน้าละ 100 ข้อความ |
| `PORT` | ไม่บังคับ; เปิด HTTP health endpoint `/health` สำหรับโฮสต์ |

ผู้ใช้ใน allowlist ได้รับคำตอบจากทุกห้องที่ **บอท** เข้าถึงได้ ไม่ได้กรองตามสิทธิ์ Discord ของผู้ถาม ลิงก์ต้นทางจะเปิดได้ต่อเมื่อผู้ถามมีสิทธิ์ในห้องต้นทางด้วย

## รันในเครื่อง

ใช้ Node.js 24 แล้วเปิด terminal ที่โฟลเดอร์ `research-bot`:

```powershell
Copy-Item .env.example .env
# กรอก .env ก่อนเริ่มบอท
npm ci
npm run check
npm test
npm start
```

หากมี `.env` อยู่แล้วให้แก้ไฟล์เดิม ไม่ต้องคัดลอกทับ เริ่มเก็บประวัติอัตโนมัติหลังเชื่อม Discord สำเร็จ และตอบคำถามได้จากส่วนที่เก็บแล้ว ใช้ `!status` ดูจำนวนข้อความและจำนวนห้องที่เก็บประวัติครบ; ใช้ `!forget` ล้างบริบทคำถามของตัวเอง

ตัวอย่างคำถาม: “ในเซิร์ฟ Friends นัดกินหมูกระทะวันไหน”, “Alice พูดเรื่อง deploy ไว้ว่าอะไร”, “ในห้อง announcements มีประกาศเรื่องงานวันศุกร์ยังไงบ้าง”

## Deploy แยก

สร้าง service ใหม่สำหรับบอทนี้ ไม่เปลี่ยน start command หรือ environment ของ service Pat เดิม

บนโฮสต์ที่รองรับ Node ตั้ง working/root directory เป็น `research-bot` (หรือ `.` หากแยก repository แล้ว), build command `npm ci --omit=dev`, start command `npm start`, และ Node 24 ตั้ง environment ชุด `RESEARCH_*` ให้ service ใหม่ ต้องเป็น process ที่ทำงานต่อเนื่องเพื่อรับ Discord Gateway events

แนบ persistent disk และตั้ง `RESEARCH_DATABASE_PATH` ไปยังไฟล์บน disk นั้น เช่น `/var/data/research/messages.sqlite` ใช้ **หนึ่ง instance ต่อฐานข้อมูล/บอท** หากใช้ filesystem ชั่วคราว ประวัติจะหายและเริ่มเก็บใหม่เมื่อ redeploy

มี Dockerfile สำหรับ build โดยใช้โฟลเดอร์นี้เป็น context:

```sh
docker build -t discord-research-bot .
docker run -d --name discord-research-bot --restart unless-stopped --env-file .env -v research-data:/app/data discord-research-bot
```

เมื่อใช้ตัวอย่าง Docker ให้ตั้ง `RESEARCH_DATABASE_PATH=/app/data/messages.sqlite` ใน `.env` ด้วย health endpoint แสดงเฉพาะสถานะการเชื่อมต่อ ไม่เปิดเผยจำนวนหรือเนื้อหาข้อความ

## ขอบเขตข้อมูลและการค้นหา

- ประวัติครั้งแรกอาจใช้เวลานานตามจำนวนเซิร์ฟเวอร์ ห้อง และ rate limit ของ Discord โปรแกรมทำต่อจาก checkpoint ได้ ค่า complete ใน `!status` หมายถึงดึงประวัติถึงข้อความแรกแล้ว ไม่ใช่ตรวจความถูกต้องของทุกข้อความซ้ำล่าสุด
- ใช้การตัดคำไทย/อังกฤษและ SQLite FTS5 ร่วมกับคำค้นที่ Gemini ช่วยสร้าง ไม่ใช่ semantic vector search หรือการรับประกันว่าค้นครบทุกข้อความ คำถามกว้างมากหรือการขอนับทุกข้อความอาจตอบไม่ได้
- ต่อคำถาม ตรวจต้นทางสูงสุด 90 ข้อความและส่งหลักฐานที่เกี่ยวข้องสูงสุด 6 ข้อความให้ Gemini อ่านข้อความยาวได้ถึง 4,000 ตัวอักษรต่อหลักฐาน ไม่ส่งทั้งเซิร์ฟเวอร์ไปยังโมเดล
- ข้อความที่แก้ไข/ลบขณะบอท offline จะถูกตรวจแก้เมื่อดึงมาเป็นผลค้น แต่คำใหม่ที่เพิ่มลงในข้อความเก่าขณะ offline อาจยังค้นไม่เจอด้วยคำใหม่นั้น หากต้องการสร้างดัชนีใหม่ทั้งหมด ให้หยุดบอท สำรองฐานข้อมูล แล้วตั้ง `RESEARCH_DATABASE_PATH` เป็นไฟล์ใหม่และเริ่มบอท
- ไม่อ่านข้อความใน DM, เนื้อหาไฟล์แนบ, รูปภาพ, embed หรือเสียง และไม่เก็บข้อความในห้องถามตอบหรือคำตอบของบอทเองเป็นหลักฐาน
- สมาชิกใน allowlist ควรเป็นผู้ที่คุณตั้งใจให้รับข้อมูลข้ามเซิร์ฟเวอร์ได้ ข้อความต้นทางที่ใช้ตอบ คำถาม และประวัติคำถามจะถูกส่งไปยัง Gemini API
- ความจำคำถามหายเมื่อ restart; ฐานข้อมูลข้อความอยู่ต่อได้ถ้า disk ถาวร ข้อความต้นทางที่ถูกลบขณะ offline อาจยังอยู่ในฐานข้อมูลจนกว่าจะถูกตรวจจากผลค้น ไม่ถือว่าการตรวจอ้างอิงเป็นระบบ retention/purge ที่สมบูรณ์

เอกสารอ้างอิง: [Discord message API และสิทธิ์อ่านประวัติ](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx), [Node.js SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)

## ตรวจสอบก่อนใช้งานจริง

เทสต์ใช้ฐานข้อมูล SQLite จริงและจำลองเฉพาะ API ภายนอก ครอบคลุม pagination/restart, edits/deletes, สิทธิ์แหล่งข้อมูล, allowlist, memory isolation, citation validation, config และ event handlers

หลังใส่ token ใหม่และเริ่มบอท ให้เชิญเข้าห้องทดสอบสองเซิร์ฟเวอร์ พิมพ์ข้อความที่มีคำเฉพาะในแต่ละเซิร์ฟเวอร์ รอ `!status` แสดงว่าเก็บแล้ว จากนั้นถามในห้อง Q&A ตรวจว่าลิงก์ชี้ถูกข้อความ แก้/ลบข้อความทดสอบแล้วถามซ้ำ และลองถามจากบัญชีที่ไม่อยู่ใน allowlist ซึ่งบอทต้องไม่ตอบ
