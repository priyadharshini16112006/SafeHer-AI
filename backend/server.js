/* ============================================================
   SafeHer AI — Main Express Server (NeDB version)
   server.js
   ============================================================ */

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const { v4: uuidv4 } = require('uuid');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

global.io = io;

const PORT = process.env.PORT || 5000;

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..')));

app.use((req, res, next) => {
  console.log(`[${new Date().toTimeString().slice(0,8)}] ${req.method} ${req.path}`);
  next();
});

// ─── Init DB then start routes ────────────────────────────────
const { db, seedData } = require('./database');

seedData().then(() => {
  // ── API Routes ──
  app.use('/uploads',       express.static(path.join(__dirname, 'data', 'uploads')));
  app.use('/api/auth',      require('./routes/auth'));
  app.use('/api/incidents', require('./routes/incidents'));
  app.use('/api/sos',       require('./routes/sos'));
  app.use('/api/analytics', require('./routes/analytics'));
  app.use('/api/community', require('./routes/community'));
  app.use('/api/predict',   require('./routes/predict'));
  app.use('/api/route',     require('./routes/route'));

  // ── Health check ──
  app.get('/api/health', async (req, res) => {
    const incCount  = await db.incidents.count({});
    const postCount = await db.posts.count({});
    res.json({
      status: 'healthy', service: 'SafeHer AI Backend', version: '1.0.0',
      db: { incidents: incCount, posts: postCount },
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // ── Catch-all → serve frontend ──
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
  });

  // ── WebSocket ──
  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);
    socket.on('disconnect', () => console.log(`❌ Disconnected: ${socket.id}`));
  });

  // ── Dev: simulate live incidents every 30s ──
  if (process.env.NODE_ENV !== 'production') {
    const liveTypes = ['Harassment', 'Stalking', 'Suspicious Activity', 'Eve-teasing'];
    const liveLocs  = [
      { name: 'Central Market', lat: 28.628, lng: 77.212 },
      { name: 'Railway Station', lat: 28.643, lng: 77.218 },
      { name: 'Bus Terminal',    lat: 28.635, lng: 77.225 },
    ];
    const liveSev = ['medium', 'high', 'critical'];

    setInterval(async () => {
      const loc  = liveLocs[Math.floor(Math.random() * liveLocs.length)];
      const type = liveTypes[Math.floor(Math.random() * liveTypes.length)];
      const sev  = liveSev[Math.floor(Math.random() * liveSev.length)];
      const risk = sev === 'critical' ? 85 + Math.floor(Math.random()*13)
                 : sev === 'high'     ? 65 + Math.floor(Math.random()*20)
                 : 40 + Math.floor(Math.random()*25);

      const doc = {
        _id: uuidv4(), type, severity: sev, ai_risk_score: risk,
        latitude: loc.lat + (Math.random()-0.5)*0.01,
        longitude: loc.lng + (Math.random()-0.5)*0.01,
        location_name: loc.name, is_anonymous: true,
        status: 'active', reported_at: new Date().toISOString(),
      };

      await db.incidents.insert(doc);
      io.emit('incident:new', { ...doc, id: doc._id });
      console.log(`🚨 [LIVE] ${type} at ${loc.name}`);
    }, 30000);
  }

  // ── Start listening ──
  server.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║       SafeHer AI — Backend Server           ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  🌐  API:    http://localhost:${PORT}/api         ║`);
    console.log(`║  🖥️   App:   http://localhost:${PORT}              ║`);
    console.log(`║  ❤️   Health: http://localhost:${PORT}/api/health  ║`);
    console.log('╚══════════════════════════════════════════════╝\n');
  });

}).catch(err => {
  console.error('❌ Failed to seed database:', err);
  process.exit(1);
});

// ─── Global Error Handlers ────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// ─── Express Error Handler ────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Express Error:', err.message);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});
