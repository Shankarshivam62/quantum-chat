# 🔐 QuantumChat v2.0
**E91 QKD · Auth · Multi-User · AI Help**

---

## 🗂 Project Structure
```
quantum-chat/
├── server/
│   ├── server.js        ← Main server (Express + Socket.IO + Auth)
│   ├── db.js            ← MySQL schema & connection
│   └── quantumE91.js    ← E91 QKD simulation + XOR encryption
├── client/
│   └── index.html       ← Full frontend (login, chat, AI help)
└── package.json
```

---

## ⚙️ Setup

### 1. Install Dependencies
```bash
npm install
```
> No bcrypt needed — passwords stored as plain text.

### 2. MySQL Setup
```sql
CREATE DATABASE quantum_chat;
```
Edit `server/db.js`:
```js
user: 'root',
password: 'your_password',
```

### 3. Environment Variables (optional)
```bash
export OPENAI_API_KEY=sk-...   # Enables full AI assistant
export PORT=3000
```

### 4. Run
```bash
npm start
```
Open: **http://localhost:3000**

---

## 🗄 What Gets Stored in MySQL (Plain Text)

| Table | What's Stored |
|---|---|
| `users` | username, display_name, **password (plain text)**, avatar_color, registered_at |
| `login_logs` | user_id, **username**, **password (plain text)**, login_time, ip_address |
| `conversations` | id, name, is_group, created_by, created_at |
| `conversation_participants` | who is in which conversation |
| `messages` | **original_message** (exact text typed), encrypted_message (quantum XOR), sent_at, sender_username |
| `ai_chat_history` | username, role, **content** (exact question/answer), sent_at |

> ✅ No hashing. No encryption of stored data. Everything is in the database exactly as entered.

---

## ✨ Features
- **Register / Login** — plain text credentials stored & compared directly
- **Login Log** — every login recorded with username, password, time, IP
- **Multi-user DM chat** — WhatsApp-style sidebar
- **Real-time messaging** — Socket.IO with typing indicators & online status
- **Quantum encryption** — E91 protocol encrypts messages in transit; original stored alongside
- **AI Help** — built-in Q&A or OpenAI GPT with per-user history in MySQL
