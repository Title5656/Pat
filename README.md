# Krai-ah (ใครอ่ะ) — Minimal Discord Voice Join/Leave Logger

บอท Discord ขนาดเล็กที่สุด ทำหน้าที่เพียง 2 อย่าง:
1. ส่งข้อความแจ้งเตือนเมื่อสมาชิกเข้าห้อง Voice Channel
2. ส่งข้อความแจ้งเตือนเมื่อสมาชิกออกจากห้อง Voice Channel

```text
🟢 @User เข้าห้อง General
🔴 @User ออกจากห้อง General
```

---

## จุดเด่น

- **Minimalist & Zero Over-engineering**: โค้ดทั้งหมดอยู่ใน `index.js` ไฟล์เดียว
- **Dependency น้อยที่สุด**: ใช้เพียง `discord.js`
- **ไม่มี Database**: ไม่มีการเก็บข้อมูลย้อนหลัง
- **Native `.env` Support**: ใช้ความสามารถของ Node.js (ไม่ต้องติดตั้ง `dotenv`)
- **ฟรี 100%**: รันบนเครื่องตนเองได้ทันที ไม่ต้องมีค่าใช้จ่าย

---

## ข้อกำหนดเบื้องต้น (Prerequisites)

- [Node.js](https://nodejs.org/) 24 LTS ขึ้นไป
- Git
- Discord Bot Token และ Channel ID สำหรับส่งข้อความ

---

## สิทธิ์ที่จำเป็นของ Discord Bot

### Gateway Intents
- `Guilds`
- `Guild Voice States`

### Bot Permissions ใน Discord Server
- `View Channels`
- `Send Messages`

---

## ขั้นตอนการติดตั้งและการใช้งาน (Setup & Run)

### 1. คัดลอกและตั้งค่า Environment Variables

คัดลอกไฟล์ `.env.example` เป็น `.env`:

```bash
cp .env.example .env
```

จากนั้นแก้ไขข้อมูลในไฟล์ `.env`:

```env
DISCORD_TOKEN=your_bot_token_here
VOICE_LOG_CHANNEL_ID=your_voice_log_channel_id_here
```

### 2. ติดตั้ง Dependencies

```bash
npm install
```

### 3. รันบอท

```bash
npm start
```

---

## การทำงานของระบบ (Behavior)

- **เข้าห้อง (JOIN)**: แจ้งเตือน `🟢 @User เข้าห้อง <ชื่อห้อง>`
- **ออกจากห้อง (LEAVE)**: แจ้งเตือน `🔴 @User ออกจากห้อง <ชื่อห้อง>`
- **ย้ายห้อง (MOVE)**: ไม่แจ้งเตือน
- **สถานะอื่นๆ (Mute / Deafen / Stream / Camera)**: ไม่แจ้งเตือน
- **บอทตัวอื่น (Bot Accounts)**: ข้ามการแจ้งเตือนทั้งหมด
