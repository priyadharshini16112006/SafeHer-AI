/* ============================================================
   SafeHer AI — Incidents Routes (NeDB)
   routes/incidents.js
   ============================================================ */

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db }  = require('../database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ensure uploads dir
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`);
  }
});
const upload = multer({ storage });

// ─── GET /incidents ───────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { type, severity, status, search, limit = 30, offset = 0 } = req.query;

    let query = {};
    if (type)     query.type     = type;
    if (severity) query.severity = severity;
    if (status)   query.status   = status;

    let docs = await db.incidents.find(query).sort({ reported_at: -1 });

    if (search) {
      const q = search.toLowerCase();
      docs = docs.filter(d =>
        (d.type || '').toLowerCase().includes(q) ||
        (d.location_name || '').toLowerCase().includes(q) ||
        (d.description || '').toLowerCase().includes(q) ||
        (d._id || '').toLowerCase().includes(q)
      );
    }

    const total    = docs.length;
    const paginated = docs.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    // Expose _id as id for frontend compatibility
    const mapped = paginated.map(d => ({ ...d, id: d._id }));

    res.json({ success: true, data: mapped, total });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /incidents/stats ─────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const all       = await db.incidents.find({});
    const todayStr  = new Date().toISOString().slice(0, 10);

    const total    = all.length;
    const active   = all.filter(d => d.status === 'active').length;
    const today    = all.filter(d => (d.reported_at || '').startsWith(todayStr)).length;
    const critical = all.filter(d => d.severity === 'critical').length;
    const highRisk = all.filter(d => d.ai_risk_score >= 80).length;
    const resolved = all.filter(d => d.status === 'resolved').length;

    // Trend: group by date (last 7 days)
    const trendMap = {};
    const cutoff   = Date.now() - 7 * 86400000;
    all.filter(d => new Date(d.reported_at).getTime() > cutoff).forEach(d => {
      const day = (d.reported_at || '').slice(0, 10);
      if (!trendMap[day]) trendMap[day] = 0;
      trendMap[day]++;
    });
    const trend = Object.entries(trendMap).sort().map(([day, count]) => ({ day, count }));

    // By type
    const typeMap = {};
    all.forEach(d => { typeMap[d.type] = (typeMap[d.type] || 0) + 1; });
    const byType = Object.entries(typeMap).sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count }));

    // By severity
    const sevMap = {};
    all.forEach(d => { sevMap[d.severity] = (sevMap[d.severity] || 0) + 1; });
    const bySeverity = Object.entries(sevMap).map(([severity, count]) => ({ severity, count }));

    res.json({ success: true, data: { total, active, today, critical, highRisk, resolved, trend, byType, bySeverity } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /incidents/heatmap ───────────────────────────────────
router.get('/heatmap', async (req, res) => {
  try {
    const { hours = 168 } = req.query;
    const cutoff = Date.now() - parseInt(hours) * 3600000;
    const docs   = await db.incidents.find({});
    const points = docs
      .filter(d => d.latitude && d.longitude && new Date(d.reported_at).getTime() > cutoff)
      .map(d => ({ lat: d.latitude, lng: d.longitude, intensity: d.ai_risk_score / 100, severity: d.severity }));

    res.json({ success: true, data: points });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /incidents/time-heatmap ──────────────────────────────
router.get('/time-heatmap', async (req, res) => {
  try {
    const docs = await db.incidents.find({});
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const grid = {};

    docs.forEach(d => {
      const dt  = new Date(d.reported_at);
      const day = dayNames[dt.getDay()];
      const hr  = dt.getHours();
      const key = `${day}_${hr}`;
      if (!grid[key]) grid[key] = { day_name: day, hour: hr, count: 0, total_risk: 0 };
      grid[key].count++;
      grid[key].total_risk += d.ai_risk_score || 0;
    });

    const rows = Object.values(grid).map(r => ({
      day_name: r.day_name,
      hour:     r.hour,
      count:    r.count,
      avg_risk: Math.round(r.total_risk / r.count),
    }));

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /incidents/:id ───────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.incidents.findOne({ _id: req.params.id });
    if (!doc) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: { ...doc, id: doc._id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /incidents ──────────────────────────────────────────
// Accept multipart/form-data: images[], video, audio, plus fields
router.post('/', upload.fields([{ name: 'images' }, { name: 'video' }, { name: 'audio' }]), async (req, res) => {
  try {
    const body = req.body || {};
    const { type, severity = 'medium', latitude, longitude, location_name, description, is_anonymous = 'false' } = body;
    if (!type || !location_name) return res.status(400).json({ success: false, error: 'type and location_name are required' });

    // build media list
    const media = [];
    const pushFile = (f) => {
      if (!f) return;
      if (Array.isArray(f)) f.forEach(x => media.push({ filename: path.basename(x.path), mimetype: x.mimetype, size: x.size, url: `/data/uploads/${path.basename(x.path)}` }));
      else media.push({ filename: path.basename(f.path), mimetype: f.mimetype, size: f.size, url: `/data/uploads/${path.basename(f.path)}` });
    };
    pushFile(req.files?.images);
    pushFile(req.files?.video);
    pushFile(req.files?.audio);

    // Simple AI classification mock: look for keywords
    const txt = (description || '').toLowerCase();
    let ai_label = 'unknown';
    if (txt.includes('stalk') || txt.includes('stalking')) ai_label = 'Stalking';
    else if (txt.includes('harass') || txt.includes('harassment')) ai_label = 'Harassment';
    else if (txt.includes('attack') || txt.includes('assault')) ai_label = 'Assault';
    else if (txt.includes('suspicious')) ai_label = 'Suspicious Activity';

    // Risk score heuristic: severity base + media presence - small random
    const riskMap       = { critical: 88, high: 68, medium: 48, low: 22 };
    let ai_risk_score = Math.min(99, (riskMap[severity] || 50) + Math.floor(Math.random() * 12));
    if (media.length) ai_risk_score = Math.min(99, ai_risk_score + 6);

    const nowIso = new Date().toISOString();
    const doc = {
      _id:          uuidv4(),
      type,
      severity,
      ai_risk_score,
      ai_label,
      is_anonymous: (is_anonymous === 'true' || is_anonymous === true),
      latitude:     parseFloat(latitude)  || 28.6139,
      longitude:    parseFloat(longitude) || 77.2090,
      location_name,
      description:  description || '',
      media,
      status:       'active',
      timeline:     [{ at: nowIso, actor: 'reporter', status: 'reported', note: 'Incident reported' }],
      admin_verified: false,
      reported_at:  nowIso,
      resolved_at:  null,
    };

    await db.incidents.insert(doc);
    if (global.io) global.io.emit('incident:new', { ...doc, id: doc._id });

    res.status(201).json({ success: true, data: { ...doc, id: doc._id }, message: 'Incident reported successfully' });
  } catch (err) {
    console.error('Incident report failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PUT /incidents/:id/status ────────────────────────────────
router.put('/:id/status', async (req, res) => {
  try {
    const { status, note, actor = 'system' } = req.body;
    if (!['active', 'investigating', 'resolved'].includes(status))
      return res.status(400).json({ success: false, error: 'Invalid status' });

    const event = { at: new Date().toISOString(), actor, status, note: note || `Status changed to ${status}` };
    const update = {
      $set: { status, resolved_at: status === 'resolved' ? new Date().toISOString() : null },
      $push: { timeline: event },
    };
    await db.incidents.update({ _id: req.params.id }, update);
    const updated = await db.incidents.findOne({ _id: req.params.id });
    res.json({ success: true, data: { ...updated, id: updated._id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PUT /incidents/:id/verify ────────────────────────────────
router.put('/:id/verify', async (req, res) => {
  try {
    const { verifier_name = 'Admin', note = 'Verified by admin' } = req.body;
    const event = { at: new Date().toISOString(), actor: verifier_name, status: 'admin_verified', note };
    const update = { $set: { admin_verified: true }, $push: { timeline: event } };
    await db.incidents.update({ _id: req.params.id }, update);
    const updated = await db.incidents.findOne({ _id: req.params.id });
    res.json({ success: true, data: { ...updated, id: updated._id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /incidents/:id/timeline ─────────────────────────────
router.post('/:id/timeline', async (req, res) => {
  try {
    const { actor = 'system', status = 'update', note } = req.body;
    if (!note) return res.status(400).json({ success: false, error: 'Timeline note is required' });
    const event = { at: new Date().toISOString(), actor, status, note };
    await db.incidents.update({ _id: req.params.id }, { $push: { timeline: event } });
    const updated = await db.incidents.findOne({ _id: req.params.id });
    res.json({ success: true, data: { ...updated, id: updated._id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
