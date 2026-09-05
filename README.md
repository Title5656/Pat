# Krai-ah (ใครอ่ะ) — Minimal Discord Voice Join/Leave Logger

[![Node.js Version](https://img.shields.io/badge/node.js-v24%20LTS-green.svg)](https://nodejs.org/)
[![discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)](https://discord.js.org/)
[![License](https://img.shields.io/badge/license-MIT-lightgrey.svg)](LICENSE)
[![Minimalist](https://img.shields.io/badge/architecture-minimalist-brightgreen.svg)]()

**Krai-ah (ใครอ่ะ)** is a lightweight, zero-overhead Discord bot engineered for one dedicated purpose: logging when members join or leave voice channels without spam or clutter.

บอท Discord ขนาดเล็กที่สุด ออกแบบมาเพื่อตรวจจับและบันทึกข้อความเมื่อมีสมาชิกเข้าหรือออกจากห้อง Voice Channel โดยเฉพาะ รวดเร็ว สะอาดตา และไม่กินทรัพยากรเครื่อง

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

### 5. Crash Resilience (ทนทาน ไม่ดับง่าย)
- ดักจับข้อผิดพลาด (Error Handling) รอบด้าน หากห้อง Log ถูกลบ หรือมีปัญหาเรื่อง Permission บอทจะแสดงข้อผิดพลาดในคอนโซลและทำงานต่อโดยไม่ Crash

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
- **discord.js v14**: ไลบรารีทางการสำหรับเชื่อมต่อ Discord Gateway API
- **Single-File Logic**: โค้ดการทำงานทั้งหมดอยู่ใน [index.js](file:///c:/Users/wpras/Desktop/Krai-ah-Bot/index.js) เพียงไฟล์เดียว
- **Zero Database / Zero Overhead**: ไม่ใช้ Database, ไม่ใช้ ORM, ไม่ต้องมี Web Server, ไม่มี Service เสียเงิน

```text
Krai-ah/
├── index.js          # Core logic (Discord client, voiceStateUpdate listener, logger)
├── .env              # Local environment variables (ignored by Git)
├── .env.example      # Template for environment variables
├── .gitignore        # Excludes node_modules/ and .env
├── package.json      # Dependencies and start scripts
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
npm install
```

### 4. Start the Bot (เปิดใช้งาน)

```bash
npm start
```

เมื่อเชื่อมต่อสำเร็จ คอนโซลจะแสดงข้อความ:

```text
Ready! Logged in as Krai-ah#7038
```

---

## Troubleshooting (การแก้ไขปัญหาเบื้องต้น)

- **`Error: DISCORD_TOKEN is not defined in environment variables.`**:
  ตรวจสอบว่าบันทึกไฟล์ `.env` แล้วหรือยัง (กด `Ctrl + S`) และตรวจสอบว่าชื่อตัวแปรสะกดถูกต้อง
- **บอทไม่ส่งข้อความเมื่อมีคนเข้า-ออก**:
  1. ตรวจสอบว่าบอทอยู่ใน Server เดียวกับที่มีห้องเสียงและห้อง Log หรือไม่
  2. ตรวจสอบว่าบอทมีสิทธิ์ `View Channel` และ `Send Messages` ในห้อง Log ที่ระบุใน `VOICE_LOG_CHANNEL_ID` หรือไม่
  3. ตรวจสอบว่าผู้ใช้ที่เข้าห้องไม่ใช่บัญชีบอท (บอทจะไม่แจ้งเตือนบัญชีที่เป็นบอท)

---
