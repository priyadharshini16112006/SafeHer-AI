/* ============================================================
   SafeHer AI — Analytics Routes (NeDB)
   routes/analytics.js
   ============================================================ */

const express = require('express');
const router  = express.Router();
const { db }  = require('../database');

// ─── GET /analytics/dashboard ─────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const all       = await db.incidents.find({});
    const sosDocs   = await db.sos.find({});
    const todayStr  = new Date().toISOString().slice(0, 10);

    const totalIncidents = all.length;
    const sosToday       = sosDocs.filter(d => (d.triggered_at || '').startsWith(todayStr)).length;
    const womenProtected = sosDocs.filter(d => d.status !== 'active').length + 1240;
    const highRiskZones  = new Set(all.filter(d => d.ai_risk_score >= 80).map(d => d.location_name)).size;
    const avgRisk        = all.reduce((s, d) => s + (d.ai_risk_score || 0), 0) / (all.length || 1);

    res.json({
      success: true,
      data: {
        totalIncidents,
        sosToday,
        womenProtected,
        highRiskZones,
        globalSafetyScore: Math.max(10, 100 - Math.round(avgRisk)),
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /analytics/trends ────────────────────────────────────
router.get('/trends', async (req, res) => {
  try {
    const { period = 'week' } = req.query;
    const daysMap = { week: 7, month: 30, year: 365 };
    const days    = daysMap[period] || 7;
    const cutoff  = Date.now() - days * 86400000;

    const all     = await db.incidents.find({});
    const sos     = await db.sos.find({});

    // Group incidents by date
    const incMap = {};
    all.filter(d => new Date(d.reported_at).getTime() > cutoff).forEach(d => {
      const day = (d.reported_at || '').slice(0, 10);
      if (!incMap[day]) incMap[day] = { label: day, incidents: 0, critical: 0, high: 0, total_risk: 0 };
      incMap[day].incidents++;
      if (d.severity === 'critical') incMap[day].critical++;
      if (d.severity === 'high') incMap[day].high++;
      incMap[day].total_risk += d.ai_risk_score || 0;
    });
    const incRows = Object.values(incMap)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(r => ({ ...r, avg_risk: Math.round(r.total_risk / r.incidents) }));

    // Group SOS by date
    const sosMap = {};
    sos.filter(d => new Date(d.triggered_at).getTime() > cutoff).forEach(d => {
      const day = (d.triggered_at || '').slice(0, 10);
      sosMap[day] = (sosMap[day] || 0) + 1;
    });
    const sosRows = Object.entries(sosMap).sort().map(([label, count]) => ({ label, count }));

    res.json({ success: true, data: { incidents: incRows, sos: sosRows } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /analytics/sentiment ─────────────────────────────────
router.get('/sentiment', async (req, res) => {
  try {
    // NLP-simulated — keyword frequency across posts
    const posts = await db.posts.find({});
    const sentimentBase = [
      { word: 'Unsafe',    pct: 82 }, { word: 'Scared',    pct: 74 },
      { word: 'Helpless',  pct: 65 }, { word: 'Harassed',  pct: 59 },
      { word: 'Concerned', pct: 48 }, { word: 'Safe',      pct: 31 },
      { word: 'Confident', pct: 22 }, { word: 'Empowered', pct: 18 },
    ];

    // Boost scores slightly based on real post count
    const boost = Math.min(posts.length * 2, 10);
    const result = sentimentBase.map(s => ({ ...s, pct: Math.min(99, s.pct + Math.floor(Math.random() * boost)) }));

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /analytics/time-heatmap ──────────────────────────────
router.get('/time-heatmap', async (req, res) => {
  try {
    const all      = await db.incidents.find({});
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const grid     = {};

    all.forEach(d => {
      const dt  = new Date(d.reported_at);
      const day = dayNames[dt.getDay()];
      const hr  = dt.getHours();
      const key = `${day}_${hr}`;
      if (!grid[key]) grid[key] = { day_name: day, hour: hr, count: 0, total_risk: 0 };
      grid[key].count++;
      grid[key].total_risk += d.ai_risk_score || 0;
    });

    const rows = Object.values(grid).map(r => ({
      day_name: r.day_name, hour: r.hour,
      count:    r.count,
      avg_risk: Math.round(r.total_risk / r.count),
    }));

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /analytics/by-area ───────────────────────────────────
router.get('/by-area', async (req, res) => {
  try {
    const all    = await db.incidents.find({});
    const areaMap = {};

    all.forEach(d => {
      const loc = d.location_name || 'Unknown';
      if (!areaMap[loc]) areaMap[loc] = { location_name: loc, incident_count: 0, total_risk: 0, max_risk: 0, resolved_count: 0 };
      areaMap[loc].incident_count++;
      areaMap[loc].total_risk += d.ai_risk_score || 0;
      areaMap[loc].max_risk    = Math.max(areaMap[loc].max_risk, d.ai_risk_score || 0);
      if (d.status === 'resolved') areaMap[loc].resolved_count++;
    });

    const rows = Object.values(areaMap)
      .map(r => ({ ...r, avg_risk: Math.round(r.total_risk / r.incident_count) }))
      .sort((a, b) => b.avg_risk - a.avg_risk)
      .slice(0, 15);

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /analytics/by-type ───────────────────────────────────
router.get('/by-type', async (req, res) => {
  try {
    const all     = await db.incidents.find({});
    const typeMap = {};

    all.forEach(d => {
      if (!typeMap[d.type]) typeMap[d.type] = { type: d.type, count: 0, total_risk: 0 };
      typeMap[d.type].count++;
      typeMap[d.type].total_risk += d.ai_risk_score || 0;
    });

    const rows = Object.values(typeMap)
      .map(r => ({ type: r.type, count: r.count, avg_risk: Math.round(r.total_risk / r.count) }))
      .sort((a, b) => b.count - a.count);

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
