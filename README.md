# Krai-ah (ใครอ่ะ) — Minimal Discord Voice Join/Leave Logger

[![Node.js Version](https://img.shields.io/badge/node.js-v24%20LTS-green.svg)](https://nodejs.org/)
[![discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)](https://discord.js.org/)

**Krai-ah (ใครอ่ะ)** is a small Discord bot for logging when members join or leave voice channels.

บอท Discord สำหรับใช้งานในเซิร์ฟเวอร์เดียว ส่งข้อความแจ้งสมาชิกเข้า–ออกห้องเสียงไปยังห้อง Log ที่กำหนด

---

## What This Bot Can Do (ความสามารถของบอท)

### 1. Voice Join Detection (ตรวจจับการเข้าห้อง)
เมื่อมีผู้ใช้เชื่อมต่อเข้าห้อง Voice Channel ใดๆ ในเซิร์ฟเวอร์ บอทจะส่งข้อความแจ้งเตือนเข้าห้อง Log ที่กำหนดทันที:
- แสดงไอคอนสถานะสีเขียว (🟢)
- ระบุชื่อห้องพร้อมลิงก์แท็กของ Discord (`#channel-name`) ที่สามารถกดเพื่อไปดูห้องนั้นได้ทันที
- เมนชันชื่อผู้ใช้ (`@User`)

### 2. Voice Leave Detection (ตรวจจับการออกจากห้อง)
เมื่อผู้ใช้ออกจากห้อง Voice Channel หรือตัดการเชื่อมต่อ:
- แสดงไอคอนสถานะสีแดง (🔴)
- ระบุห้องที่ผู้ใช้ออกมา
- เมนชันชื่อผู้ใช้

### 3. Anti-Spam & Smart Filtering (กรองเหตุการณ์ไม่จำเป็น)
เพื่อป้องกันไม่ให้ห้อง Log เต็มไปด้วยข้อความรก (Spam):
- **ไม่บันทึกการย้ายห้อง (Ignore Voice Moves)**: การย้ายจากห้องหนึ่งไปอีกห้องหนึ่ง (เช่น General ➔ Gaming) จะไม่ถูกบันทึก
- **ไม่บันทึกการเปลี่ยนสถานะไมค์/หูฟัง**: ปิด/เปิดไมค์ (Mute/Unmute), ปิด/เปิดหูฟัง (Deafen/Undeafen) ทั้งแบบส่วนตัวและระดับเซิร์ฟเวอร์จะไม่สร้างข้อความ
- **ไม่บันทึกการเปิดกล้อง/สตรีม**: การเปิด/ปิดกล้อง (Video) หรือแชร์หน้าจอ (Screen Share) จะถูกละเว้นทั้งหมด
- **กรองบอทตัวอื่น (Ignore Bot Accounts)**: บอทตัวอื่นเข้า-ออกห้องเสียงจะไม่ถูกนำมา Log

### 4. Clean & Spaced Layout (อ่านง่าย สบายตา)
- ใช้รูปแบบ **Discord Blockquotes (`> `)** เพื่อสร้างแถบกรอบและระยะขอบรอบข้อความ
- แยกข้อมูลออกเป็น 2 บรรทัดพร้อมระบุสถานะและผู้ใช้
- ใช้ตัวคั่นช่องว่าง (`_ _`) ป้องกันไม่ให้ Discord รวมข้อความที่ส่งติดๆ กันเป็นก้อนเดียวที่อ่านยาก

### 5. Voice Log Error Handling (จัดการข้อผิดพลาดในการส่ง Log)
- หากค้นหาห้อง Log หรือส่งข้อความไม่สำเร็จ บอทจะบันทึกข้อผิดพลาดในคอนโซลและจบการจัดการเหตุการณ์นั้น โดยไม่ส่งข้อผิดพลาดออกจากตัวจัดการเหตุการณ์

---

## Message Preview (ตัวอย่างข้อความแจ้งเตือน)

```text
> 🟢 เข้าห้อง: 🔊 General
> 👤 @Title

> 🔴 ออกจากห้อง: 🔊 General
> 👤 @Title
```

---

## Architecture & Tech Stack (เทคโนโลยีและสถาปัตยกรรม)

- **Node.js 24 LTS**: ใช้ความสามารถ Native `--env-file` ในการโหลดตัวแปรสภาพแวดล้อมโดยตรง ไม่ต้องพึ่งพาแพ็กเกจภายนอกอย่าง `dotenv`
- **discord.js v14**: ไลบรารีสำหรับเชื่อมต่อ Discord API
- **Single-File Logic**: โค้ดการทำงานทั้งหมดอยู่ใน [index.js](index.js) เพียงไฟล์เดียว
- **No Database**: ไม่ใช้ Database หรือ ORM; บน Render จะเปิด HTTP endpoint ขนาดเล็กสำหรับตรวจสถานะ

```text
Krai-ah/
├── index.js          # Core logic (Discord client, voiceStateUpdate listener, logger)
├── .env              # Local environment variables (ignored by Git)
├── .env.example      # Template for environment variables
├── .gitignore        # Excludes node_modules/ and .env
├── package.json      # Dependencies and start scripts
├── package-lock.json # Locked dependency versions
├── .node-version     # Node.js major version
├── test/             # Voice event regression tests
└── README.md         # Project documentation
```

---

## Discord Bot Setup & Permissions (การตั้งค่าใน Discord)

### 1. Gateway Intents
ในการตั้งค่าของบอทบน [Discord Developer Portal](https://discord.com/developers/applications):
- โค้ดใช้ Intent พื้นฐาน:
  - `GatewayIntentBits.Guilds`
  - `GatewayIntentBits.GuildVoiceStates`

### 2. Permissions ที่บอทต้องการใน Server
ให้สิทธิ์เพียง 2 อย่างในห้อง Log:
- `View Channels` (ดูช่อง)
- `Send Messages` (ส่งข้อความ)

*(ไม่จำเป็นต้องให้สิทธิ์ Administrator หรือ Manage Channels)*

---

## Getting Started (ขั้นตอนการติดตั้งและการรัน)

### 1. Clone Repository

```bash
git clone https://github.com/Title5656/Krai-ah.git
cd Krai-ah
```

### 2. Configure Environment Variables (ตั้งค่าตัวแปรระบบ)

คัดลอกไฟล์ `.env.example` เป็น `.env`:

```bash
cp .env.example .env
```

แก้ไขไฟล์ `.env` โดยระบุ Token และ Channel ID:

```env
DISCORD_TOKEN=your_bot_token_here
VOICE_LOG_CHANNEL_ID=your_log_channel_id_here
```

| ตัวแปร | คำอธิบาย | ตัวอย่าง |
|---|---|---|
| `DISCORD_TOKEN` | Token ของ Discord Bot ที่ได้จาก Developer Portal | `MTU0NTc...` |
| `VOICE_LOG_CHANNEL_ID` | Channel ID ของห้องข้อความที่จะให้ส่ง Log | `1545793981722656798` |

> [!TIP]
> วิธีดู Channel ID: เปิด Developer Mode ใน User Settings > Advanced จากนั้นคลิกขวาที่ห้องข้อความแล้วเลือก **"Copy Channel ID"**

### 3. Install Dependencies (ติดตั้งแพ็กเกจ)

```bash
npm ci
```

### 4. Start the Bot (เปิดใช้งาน)

```bash
npm start
```

เมื่อเชื่อมต่อสำเร็จ คอนโซลจะแสดงข้อความ:

```text
Ready! Logged in as Krai-ah#7038
```

### Check and Test (ตรวจโค้ดและทดสอบ)

```bash
npm run check
npm test
```

ชุดทดสอบใช้ Node.js test runner และจำลองการเชื่อมต่อ Discord โดยไม่อ่าน `.env` หรือส่งข้อความจริง ครอบคลุมการเข้า–ออกห้อง การกรองเหตุการณ์ ห้องที่ส่งข้อความไม่ได้ และข้อผิดพลาดจากการค้นหาห้องหรือส่งข้อความ

GitHub Actions จะตรวจ syntax และรันชุดทดสอบเมื่อ push หรือเปิด pull request โดยไม่ต้องตั้งค่า Discord Token

Workflow [Bot CI](.github/workflows/ci.yml) ใช้ Node.js ตาม `.node-version` ติดตั้ง dependency จาก lockfile ด้วย `npm ci` และหยุดเมื่อขั้นตอนใดล้มเหลว สามารถสั่งรันเองจากหน้า Actions ได้ หากมี commit ใหม่บนสาขาหรือ PR เดิม จะยกเลิกรอบเก่าที่ยังทำงานอยู่

เพื่อป้องกันโค้ดที่ไม่ผ่านเข้า `main` ให้ตั้ง Branch Protection ใน GitHub หลัง workflow รันครั้งแรก:

1. ไปที่ **Settings → Branches → Add branch protection rule** และระบุ `main`
2. เปิด **Require a pull request before merging**
3. เปิด **Require status checks to pass before merging** แล้วเลือก **Bot checks**
4. เปิด **Require branches to be up to date before merging**
5. เปิด **Do not allow bypassing the above settings** หากต้องการให้กฎใช้กับผู้ดูแลด้วย

CI ที่รันหลัง push เข้า `main` ไม่ย้อนกลับ commit ที่ push ไปแล้ว การป้องกันก่อนเข้า `main` ต้องใช้ PR ร่วมกับกฎข้างต้น และชุดทดสอบจำลอง Discord จึงไม่ได้ยืนยันว่าสิทธิ์หรือ Token ของระบบจริงถูกต้อง

### Run on Render Free

Create a **Web Service** from this repository. Use `npm ci` as the build command and `node index.js` as the start command. Set `DISCORD_TOKEN` and `VOICE_LOG_CHANNEL_ID` in Render's environment settings; never commit `.env`. Render provides `PORT` automatically, and `/` returns `ok` when Discord is connected (HTTP 503 otherwise).

Render Free web services sleep after 15 minutes without inbound requests. An external monitor must request the service URL regularly to keep the bot connected. Discord voice events cannot wake a sleeping web service, so events during sleep or restarts may be missed.
This repository includes a GitHub Actions ping every ten minutes. GitHub may delay or skip scheduled runs and automatically disables schedules in public repositories after 60 days without repository activity. Use a separate uptime monitor for longer-term service.

---

## Troubleshooting (การแก้ไขปัญหาเบื้องต้น)

- **`Error: DISCORD_TOKEN is not defined in environment variables.`**:
  ตรวจสอบว่าบันทึกไฟล์ `.env` แล้วหรือยัง (กด `Ctrl + S`) และตรวจสอบว่าชื่อตัวแปรสะกดถูกต้อง
- **บอทไม่ส่งข้อความเมื่อมีคนเข้า-ออก**:
  1. ตรวจสอบว่าบอทอยู่ใน Server เดียวกับที่มีห้องเสียงและห้อง Log หรือไม่
  2. ตรวจสอบว่าบอทมีสิทธิ์ `View Channel` และ `Send Messages` ในห้อง Log ที่ระบุใน `VOICE_LOG_CHANNEL_ID` หรือไม่
  3. ตรวจสอบว่าผู้ใช้ที่เข้าห้องไม่ใช่บัญชีบอท (บอทจะไม่แจ้งเตือนบัญชีที่เป็นบอท)

---
