// ============================================================
// server.js - Quantum Secure Chat v2.0
// Plain-text storage: passwords, messages, login logs — all raw
// NO bcrypt | NO password hashing | Data stored as-is in MySQL
// ============================================================

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const cors     = require('cors');
const jwt      = require('jsonwebtoken');
const path     = require('path');

const { db, initDatabase }                        = require('./db');
const { runE91Protocol, encryptMessage, decryptMessage } = require('./quantumE91');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ── Config ──────────────────────────────────────────────────
const JWT_SECRET     = process.env.JWT_SECRET  || 'quantum_jwt_secret_change_in_prod';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const PORT           = process.env.PORT || 3000;

const AVATAR_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316',
  '#eab308','#22c55e','#06b6d4','#3b82f6','#a855f7'
];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// ── In-memory: socket.id → { userId, username, quantumKey } ─
const connectedSockets = {};

// ── JWT middleware ───────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

// Helper: get client IP
function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '';
}

// ============================================================
// AUTH ROUTES
// ============================================================

// POST /api/register — store username + password exactly as typed
app.post('/api/register', async (req, res) => {
  const { username, password, display_name } = req.body;

  if (!username || !password)
    return res.status(400).json({ success: false, error: 'Username and password are required.' });

  if (password.length < 4)
    return res.status(400).json({ success: false, error: 'Password must be at least 4 characters.' });

  try {
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    const dname = (display_name || '').trim() || username.trim();

    // ✅ Password stored as plain text — exactly what the user typed
    await db.execute(
      `INSERT INTO users (username, display_name, password, avatar_color)
       VALUES (?, ?, ?, ?)`,
      [username.toLowerCase().trim(), dname, password, color]
    );

    console.log(`📝 New user registered: username="${username}" password="${password}" display_name="${dname}" at ${new Date().toISOString()}`);
    res.json({ success: true, message: 'Account created successfully.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(400).json({ success: false, error: 'Username already taken.' });
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/login — compare plain text password directly
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password)
    return res.status(400).json({ success: false, error: 'Username and password are required.' });

  try {
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE username = ?',
      [username.toLowerCase().trim()]
    );

    if (!rows.length)
      return res.status(401).json({ success: false, error: 'Invalid username or password.' });

    const user = rows[0];

    // ✅ Direct plain-text comparison — no hash
    if (user.password !== password)
      return res.status(401).json({ success: false, error: 'Invalid username or password.' });

    // Mark online & update last_seen
    await db.execute(
      'UPDATE users SET is_online = 1, last_seen = NOW() WHERE id = ?',
      [user.id]
    );

    // ✅ Log every login with exact username, password and timestamp
    await db.execute(
      `INSERT INTO login_logs (user_id, username, password, ip_address)
       VALUES (?, ?, ?, ?)`,
      [user.id, user.username, password, getIP(req)]
    );

    console.log(`🔓 Login: username="${user.username}" password="${password}" ip="${getIP(req)}" at ${new Date().toISOString()}`);

    const token = jwt.sign(
      { id: user.id, username: user.username, display_name: user.display_name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id:           user.id,
        username:     user.username,
        display_name: user.display_name,
        avatar_color: user.avatar_color,
        status:       user.status,
        registered_at: user.registered_at
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// USER ROUTES
// ============================================================

// GET /api/users — all users except self
app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, username, display_name, avatar_color, status, is_online, last_seen, registered_at
       FROM users WHERE id != ?
       ORDER BY is_online DESC, display_name ASC`,
      [req.user.id]
    );
    res.json({ success: true, users: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// CONVERSATION ROUTES
// ============================================================

// GET /api/conversations
app.get('/api/conversations', authMiddleware, async (req, res) => {
  try {
    const [convs] = await db.execute(`
      SELECT
        c.id, c.name, c.is_group, c.created_at,
        (SELECT m.original_message FROM messages m
         WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC LIMIT 1) AS last_message,
        (SELECT m.sent_at FROM messages m
         WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC LIMIT 1) AS last_message_time
      FROM conversations c
      JOIN conversation_participants cp ON cp.conversation_id = c.id
      WHERE cp.user_id = ?
      ORDER BY last_message_time DESC
    `, [req.user.id]);

    for (let conv of convs) {
      if (!conv.is_group) {
        const [parts] = await db.execute(`
          SELECT u.id, u.username, u.display_name, u.avatar_color, u.is_online
          FROM conversation_participants cp
          JOIN users u ON u.id = cp.user_id
          WHERE cp.conversation_id = ? AND cp.user_id != ?
        `, [conv.id, req.user.id]);
        conv.other_user = parts[0] || null;
      }
    }

    res.json({ success: true, conversations: convs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/conversations/dm — get or create DM
app.post('/api/conversations/dm', authMiddleware, async (req, res) => {
  const { target_user_id } = req.body;
  if (!target_user_id)
    return res.status(400).json({ success: false, error: 'target_user_id required' });

  try {
    const [existing] = await db.execute(`
      SELECT c.id FROM conversations c
      JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
      JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
      WHERE c.is_group = 0
      LIMIT 1
    `, [req.user.id, target_user_id]);

    if (existing.length)
      return res.json({ success: true, conversation_id: existing[0].id });

    const [result] = await db.execute(
      'INSERT INTO conversations (is_group, created_by) VALUES (0, ?)',
      [req.user.id]
    );
    const convId = result.insertId;

    await db.execute(
      'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)',
      [convId, req.user.id, convId, target_user_id]
    );

    res.json({ success: true, conversation_id: convId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/conversations/:id/messages — load chat history
app.get('/api/conversations/:id/messages', authMiddleware, async (req, res) => {
  const convId = req.params.id;
  try {
    const [check] = await db.execute(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [convId, req.user.id]
    );
    if (!check.length)
      return res.status(403).json({ success: false, error: 'Not a participant.' });

    // ✅ Returns original_message exactly as the user typed it
    const [msgs] = await db.execute(`
      SELECT
        m.id,
        m.original_message,
        m.encrypted_message,
        m.message_type,
        m.sent_at,
        m.sender_username,
        u.id          AS sender_id,
        u.display_name,
        u.avatar_color
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ?
      ORDER BY m.sent_at ASC
      LIMIT 200
    `, [convId]);

    res.json({ success: true, messages: msgs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// AI HELP ROUTES
// ============================================================

// POST /api/ai/chat
app.post('/api/ai/chat', authMiddleware, async (req, res) => {
  const { message } = req.body;
  if (!message)
    return res.status(400).json({ success: false, error: 'Message required.' });

  try {
    // ✅ Store user's plain-text question exactly as typed
    await db.execute(
      `INSERT INTO ai_chat_history (user_id, username, role, content)
       VALUES (?, ?, 'user', ?)`,
      [req.user.id, req.user.username, message]
    );

    // Load conversation context (last 10 exchanges)
    const [history] = await db.execute(
      `SELECT role, content FROM ai_chat_history
       WHERE user_id = ? ORDER BY sent_at DESC LIMIT 10`,
      [req.user.id]
    );
    const messages = history.reverse().map(h => ({ role: h.role, content: h.content }));

    let reply;

    if (!OPENAI_API_KEY) {
      reply = getBuiltInAnswer(message);
    } else {
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant for QuantumChat — a quantum-secured messaging app using the E91 QKD protocol. Help users understand features, quantum cryptography, and troubleshoot issues. Be concise and friendly.'
            },
            ...messages
          ],
          max_tokens: 500
        })
      });
      const aiData = await openaiRes.json();
      reply = aiData.choices?.[0]?.message?.content || 'Sorry, I could not get a response.';
    }

    // ✅ Store AI reply as plain text
    await db.execute(
      `INSERT INTO ai_chat_history (user_id, username, role, content)
       VALUES (?, ?, 'assistant', ?)`,
      [req.user.id, req.user.username, reply]
    );

    res.json({ success: true, reply });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/ai/history
app.get('/api/ai/history', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT role, content, sent_at
       FROM ai_chat_history WHERE user_id = ?
       ORDER BY sent_at ASC LIMIT 100`,
      [req.user.id]
    );
    res.json({ success: true, history: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Built-in fallback answers when no OpenAI key is set
function getBuiltInAnswer(msg) {
  const q = msg.toLowerCase();
  if (q.includes('e91') || q.includes('quantum key'))
    return 'The E91 protocol uses quantum entanglement (EPR pairs) to generate a shared secret key. Security is guaranteed by Bell\'s inequality — any eavesdropping disturbs the quantum state and is immediately detectable.';
  if (q.includes('encrypt') || q.includes('decrypt'))
    return 'QuantumChat encrypts your messages using XOR encryption with a quantum-generated key from the E91 protocol. The original message is always saved separately so you can read it normally.';
  if (q.includes('password') || q.includes('login') || q.includes('register'))
    return 'Register with a username and password. Your credentials are stored in the database as you enter them. Log in anytime with the same username and password.';
  if (q.includes('chat') || q.includes('message') || q.includes('send'))
    return 'Click any user in the People tab to open a chat. Type your message and press Enter or click Send. Messages are encrypted in transit using your quantum key.';
  if (q.includes('openai') || q.includes('api key'))
    return 'Set the OPENAI_API_KEY environment variable to enable full AI assistance powered by GPT. Without it I use built-in answers about QuantumChat.';
  return 'I\'m your QuantumChat assistant! Ask me about the E91 protocol, encryption, how to use the app, or anything technical.';
}

// GET /api/generate-key — test QKD
app.get('/api/generate-key', authMiddleware, (req, res) => {
  const qkdResult = runE91Protocol(20);
  res.json({ success: true, qkdResult });
});

// ============================================================
// SOCKET.IO — Real-time messaging
// ============================================================
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', async (socket) => {
  const { id: userId, username, display_name } = socket.user;
  console.log(`🔌 ${display_name || username} connected (${socket.id})`);

  // Generate fresh quantum key for this session
  const qkdResult = runE91Protocol(20);
  connectedSockets[socket.id] = { userId, username, display_name, quantumKey: qkdResult.finalKey };

  // Mark online
  await db.execute('UPDATE users SET is_online = 1, last_seen = NOW() WHERE id = ?', [userId]);

  // Auto-join all existing conversation rooms
  const [convs] = await db.execute(
    'SELECT conversation_id FROM conversation_participants WHERE user_id = ?', [userId]
  );
  convs.forEach(c => socket.join(`conv_${c.conversation_id}`));

  // Notify others: this user is online
  socket.broadcast.emit('user_status', { userId, is_online: true });

  // Send QKD info back to this client
  socket.emit('qkd_complete', { qkdResult });

  // ── SEND MESSAGE ─────────────────────────────────────────
  socket.on('send_message', async ({ conversation_id, message }) => {
    if (!message?.trim()) return;
    const info = connectedSockets[socket.id];
    if (!info) return;

    // Verify sender is in this conversation
    const [check] = await db.execute(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversation_id, userId]
    );
    if (!check.length) return;

    // Quantum-encrypt the message for the encrypted_message column
    let encryptedMessage = '';
    try {
      if (info.quantumKey?.length > 0)
        encryptedMessage = encryptMessage(message.trim(), info.quantumKey);
    } catch (e) {
      encryptedMessage = '[encryption failed]';
    }

    // ✅ Save to DB:
    //    original_message  = exactly what the user typed
    //    encrypted_message = quantum XOR version
    const [result] = await db.execute(
      `INSERT INTO messages
         (conversation_id, sender_id, sender_username, original_message, encrypted_message)
       VALUES (?, ?, ?, ?, ?)`,
      [conversation_id, userId, username, message.trim(), encryptedMessage]
    );

    // Get sender's avatar colour
    const [[userRow]] = await db.execute('SELECT avatar_color FROM users WHERE id=?', [userId]);

    console.log(`📨 [${username}] → conv#${conversation_id}: "${message.trim()}" | enc: ${encryptedMessage.substring(0,20)}...`);

    // Broadcast to everyone in this conversation room
    io.to(`conv_${conversation_id}`).emit('receive_message', {
      id:                result.insertId,
      conversation_id,
      message:           message.trim(),       // original plain text
      original_message:  message.trim(),
      encrypted_message: encryptedMessage,
      sender_id:         userId,
      username,
      display_name:      display_name || username,
      avatar_color:      userRow?.avatar_color || '#6366f1',
      sent_at:           new Date().toISOString(),
      message_type:      'text'
    });
  });

  // ── JOIN CONVERSATION ROOM ────────────────────────────────
  socket.on('join_conversation', ({ conversation_id }) => {
    socket.join(`conv_${conversation_id}`);
  });

  // ── TYPING INDICATORS ─────────────────────────────────────
  socket.on('typing', ({ conversation_id }) => {
    socket.to(`conv_${conversation_id}`).emit('user_typing', {
      userId,
      display_name: display_name || username,
      conversation_id
    });
  });

  socket.on('stop_typing', ({ conversation_id }) => {
    socket.to(`conv_${conversation_id}`).emit('user_stop_typing', {
      userId,
      conversation_id
    });
  });

  // ── DISCONNECT ────────────────────────────────────────────
  socket.on('disconnect', async () => {
    delete connectedSockets[socket.id];
    await db.execute(
      'UPDATE users SET is_online = 0, last_seen = NOW() WHERE id = ?',
      [userId]
    );
    socket.broadcast.emit('user_status', { userId, is_online: false });
    console.log(`❌ ${display_name || username} disconnected`);
  });
});

// ============================================================
// Start Server
// ============================================================
async function startServer() {
  try {
    console.log('🔄 Connecting to MySQL and initializing database...');
    await initDatabase();
    console.log('✅ MySQL connected and tables ready.');
    server.listen(PORT, () => {
      console.log('');
      console.log('╔══════════════════════════════════════════════════════════╗');
      console.log('║   🔐 Quantum Secure Chat v2.0 — Server Running           ║');
      console.log(`║   📡 URL: http://localhost:${PORT}                         ║`);
      console.log('║   🗄  Storage: Plain text (no hashing)                   ║');
      console.log('║   📖 Protocol: E91 QKD Simulation                        ║');
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log('');
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    console.error('💡 Check MySQL credentials in server/db.js');
    process.exit(1);
  }
}

startServer();
