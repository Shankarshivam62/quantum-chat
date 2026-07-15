// ============================================================
// db.js - MySQL Database Connection & Schema
// Quantum Secure Chat Application v2.0
// ALL DATA STORED AS PLAIN TEXT — NO HASHING, NO ENCRYPTION
// ============================================================

const mysql = require('mysql2');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',             // ← Change to your MySQL username
  password: 'Sitaram620@',  // ← Change to your MySQL password
  database: 'quantum_chat',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const db = pool.promise();

// -------------------------------------------------------
// Initialize Database
// ALL fields stored exactly as the user enters them
// Passwords: plain text | Messages: raw original text
// -------------------------------------------------------
async function initDatabase() {
  try {

    // ── USERS ──────────────────────────────────────────────
    // password stored exactly as typed — no hashing
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        username      VARCHAR(100) NOT NULL UNIQUE,
        display_name  VARCHAR(150),
        password      VARCHAR(255) NOT NULL,
        avatar_color  VARCHAR(20)  DEFAULT '#6366f1',
        status        VARCHAR(200) DEFAULT 'Hey, I am using Quantum Chat!',
        is_online     TINYINT(1)   DEFAULT 0,
        last_seen     DATETIME     DEFAULT CURRENT_TIMESTAMP,
        registered_at DATETIME     DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── LOGIN LOGS ─────────────────────────────────────────
    // Every login is recorded with the exact username, password & time
    await db.execute(`
      CREATE TABLE IF NOT EXISTS login_logs (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        user_id    INT          NOT NULL,
        username   VARCHAR(100) NOT NULL,
        password   VARCHAR(255) NOT NULL,
        login_time DATETIME     DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(60),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // ── CONVERSATIONS ──────────────────────────────────────
    await db.execute(`
      CREATE TABLE IF NOT EXISTS conversations (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        name       VARCHAR(200),
        is_group   TINYINT(1) DEFAULT 0,
        created_by INT,
        created_at DATETIME   DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // ── CONVERSATION PARTICIPANTS ───────────────────────────
    await db.execute(`
      CREATE TABLE IF NOT EXISTS conversation_participants (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT NOT NULL,
        user_id         INT NOT NULL,
        joined_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_conv_user (conversation_id, user_id),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id)         REFERENCES users(id)         ON DELETE CASCADE
      )
    `);

    // ── MESSAGES ───────────────────────────────────────────
    // original_message = exactly what the user typed (plain text)
    // encrypted_message = quantum XOR encrypted version (for display)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id                INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id   INT          NOT NULL,
        sender_id         INT          NOT NULL,
        sender_username   VARCHAR(100) NOT NULL,
        original_message  TEXT         NOT NULL,
        encrypted_message TEXT,
        message_type      ENUM('text','system') DEFAULT 'text',
        sent_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (sender_id)       REFERENCES users(id)         ON DELETE CASCADE
      )
    `);

    // ── AI CHAT HISTORY ────────────────────────────────────
    // Stores plain text questions and answers per user
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ai_chat_history (
        id       INT AUTO_INCREMENT PRIMARY KEY,
        user_id  INT          NOT NULL,
        username VARCHAR(100) NOT NULL,
        role     ENUM('user','assistant') NOT NULL,
        content  TEXT         NOT NULL,
        sent_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    console.log('✅ Database tables initialized successfully.');
  } catch (err) {
    console.error('❌ Error initializing database tables:', err.message);
    throw err;
  }
}

module.exports = { db, initDatabase };
