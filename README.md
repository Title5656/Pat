# Pat (แพท)

บอท Discord สำหรับคุยกับแพทผ่าน Gemini และรวมแจ้งเตือนห้องเสียงจากทุกเซิร์ฟเวอร์ที่บอทเข้าร่วมไว้ในช่องหลัก

URL บน Render: https://pat-discord-bot.onrender.com/

## การทำงานหลัก

- พิมพ์คุยหรือส่งรูปขนาดไม่เกิน 10 MB ให้แพทวิเคราะห์ได้ในห้องที่กำหนดด้วย `PAT_CHAT_CHANNEL_ID`
- เปิดห้องค้นข้อมูลเพิ่มด้วย `PAT_RESEARCH_CHANNEL_ID`: Pat ตัวเดิมใช้ persona ตอบตามหลักฐาน ค้นข้อความข้ามเซิร์ฟเวอร์ พร้อมลิงก์ต้นทาง รวมถึงดูรายชื่อห้องและอ่านข้อความจริงแบบแบ่งชุดได้
- ห้องคุยเดิมและห้องค้นข้อมูลแยก persona และความจำกัน; ไม่ตอบข้อความในห้องอื่นหรือจากบัญชีบอท
- จำบทสนทนา 12 ข้อความล่าสุดแยกตามห้องระหว่างที่โปรเซสทำงาน
- ตอบด้วยภาษาไทยและคงคาแรกเตอร์เอ๋อแบบน่ารัก โดยยังรักษาความถูกต้องของสาระหลัก
- แสดงสาเหตุจาก Gemini ต่อท้าย fallback โดยปิดบัง key และ token ก่อนส่งเข้า Discord
- แจ้งเข้า ออก และย้ายห้องเสียง รวมถึงเปลี่ยนสถานะไมค์ หูฟัง และเริ่ม–หยุดสตรีม
- แสดงชื่อสมาชิก ชื่อห้อง และเวลาไทย (`Asia/Bangkok`) ใน Embed โดยไม่ ping สมาชิก
- ใช้เซิร์ฟเวอร์ของ `VOICE_LOG_CHANNEL_ID` เป็นเซิร์ฟเวอร์หลัก เหตุการณ์จากเซิร์ฟเวอร์อื่นจะต่อท้ายชื่อห้อง เช่น `General` (เซิร์ฟเวอร์: Friends) ทั้งห้องต้นทางและปลายทางเมื่อย้ายห้อง
- ระยะเวลาอยู่ในห้องและระยะเวลาสตรีมแสดง `Coming soon` จนกว่าจะมีระบบเก็บเวลาเริ่มข้ามรีสตาร์ต
- ละเว้นการเปลี่ยนสถานะกล้องที่ไม่เกี่ยวกับสตรีม
- ละเว้นบัญชีบอท
- บันทึกข้อผิดพลาดในคอนโซลเมื่อค้นหาห้องหรือส่งข้อความไม่สำเร็จ

## การตั้งค่า

คัดลอก `.env.example` เป็น `.env` แล้วกำหนดค่าต่อไปนี้:

- `DISCORD_TOKEN` — token ของ Discord bot
- `VOICE_LOG_CHANNEL_ID` — ID ของช่องในเซิร์ฟเวอร์หลักสำหรับรวม voice log จากทุกเซิร์ฟเวอร์ บอทต้องเข้าถึงช่องและมีสิทธิ์ส่งข้อความและ Embed
- `PAT_CHAT_CHANNEL_ID` — ID ของห้องคุยกับ persona เดิมของแพท
- `GEMINI_API_KEY` — API key จาก Google AI Studio
- `GEMINI_MODEL` — โมเดล Gemini เช่น `gemini-flash-latest`

เปิด **Message Content Intent** ใน Discord Developer Portal แล้วเริ่มบอทด้วย `npm start` สมาชิกสามารถพิมพ์คุยกับแพทได้ทันทีในห้องที่กำหนด

หากต้องการเปิดฟีเจอร์ค้นข้อมูล ให้เพิ่มสองค่าใน `.env` เดิมหรือ Environment ของ Render service เดิม:

```dotenv
PAT_RESEARCH_CHANNEL_ID=ใส่_ID_ห้องค้นข้อมูล
```

ห้องค้นข้อมูลต้องเป็น private และคนละห้องกับ `PAT_CHAT_CHANNEL_ID` สมาชิกทุกคนที่ Discord อนุญาตให้เห็นห้องสามารถถามได้ ใช้ `DISCORD_TOKEN`, `GEMINI_API_KEY`, `GEMINI_MODEL` และ service เดิมทั้งหมด ไม่ต้องสร้าง Discord Application ใหม่ ไม่ต้องใช้ค่า `RESEARCH_DISCORD_TOKEN`, `RESEARCH_APPLICATION_ID` หรือ `RESEARCH_GEMINI_API_KEY` แล้ว หากเว้น `PAT_RESEARCH_CHANNEL_ID` ว่าง ฟีเจอร์นี้จะปิดและ Pat ทำงานตามเดิม

คำสั่งในห้องค้นข้อมูลเป็นแบบ read-only ต่อทุกเซิร์ฟเวอร์: อ่านรายชื่อห้อง อ่านข้อความ และค้นหาได้ แต่ไม่ลบ แก้ไข สร้างห้อง หรือเปลี่ยนสิทธิ์บน Discord คำสั่ง `!reset` ล้างเฉพาะ session ชั่วคราวของผู้สั่ง ไม่กระทบเซิร์ฟเวอร์หรือผู้ใช้คนอื่น

บน Render ใช้ root directory ของ repo เดิม, build `npm ci`, start `npm start`, Node 24 และ health path `/health` หากต้องการเก็บดัชนีข้าม redeploy ให้แนบ persistent disk แล้วตั้ง `PAT_RESEARCH_DATABASE_PATH=/var/data/research.sqlite` ดู [วิธีตั้งห้องและขอบเขตการค้น](docs/research.md)

## เทคโนโลยีและโครงสร้าง

ใช้ Node.js 24, discord.js v14 และ Google Gen AI SDK ความจำบทสนทนาจะหายเมื่อโปรเซสรีสตาร์ต ส่วนฟีเจอร์ค้นข้อมูลใช้ SQLite เก็บดัชนีข้อความใน `data/research.sqlite` หรือ path ที่กำหนดบน persistent disk

```text
Pat/
├── index.js                 # เชื่อมต่อ Discord และประกอบระบบต่าง ๆ
├── src/chat/                # คำสั่ง คาแรกเตอร์ memory และ Gemini adapter
├── src/research/            # ฟีเจอร์ค้นข้อความ ใช้ Discord client และ Gemini key เดิม
├── test/                    # ทดสอบ voice logger และระบบแชต
├── .github/workflows/      # งานอัตโนมัติ รวมถึง CI ตรวจโค้ดและเทสต์
├── .env.example            # ตัวอย่างตัวแปรตั้งค่า
├── .gitignore              # ไฟล์ที่ไม่เก็บใน Git
├── .node-version           # เวอร์ชัน Node.js
├── package.json            # ข้อมูลแพ็กเกจและคำสั่งของโปรเจกต์
├── package-lock.json       # เวอร์ชัน dependency ที่ล็อกไว้
├── CHANGELOG.md            # บันทึกการเปลี่ยนแปลง
└── README.md               # ภาพรวมโปรเจกต์
```
