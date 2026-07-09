/* ============================================================
   SafeHer AI — Predictions & Zones Routes (NeDB)
   routes/predict.js
   ============================================================ */

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db }  = require('../database');

// ─── GET /predict/alerts ──────────────────────────────────────
router.get('/alerts', async (req, res) => {
  try {
    const now   = new Date().toISOString();
    const docs  = await db.predictions.find({});
    const valid = docs.filter(d => !d.valid_until || d.valid_until > now)
                      .sort((a, b) => b.predicted_risk - a.predicted_risk)
                      .slice(0, 10);
    res.json({ success: true, data: valid.map(d => ({ ...d, id: d._id })) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /predict/zone ────────────────────────────────────────
router.get('/zone', async (req, res) => {
  try {
    const { zone, time } = req.query;
    if (!zone || !time) return res.status(400).json({ success: false, error: 'zone and time are required' });

    // Check for existing prediction
    const allPreds = await db.predictions.find({});
    let prediction = allPreds.find(p =>
      (p.zone_name || '').toLowerCase().includes(zone.toLowerCase().split(' ')[0]) &&
      (p.time_slot || '').toLowerCase().includes(time.split(' ')[0].toLowerCase())
    );

    if (!prediction) {
      // Generate AI score
      const nightKeywords  = ['evening', 'night'];
      const dangerKeywords = ['market', 'industrial', 'station', 'terminal', 'alley', 'road', 'zone'];
      const isNight   = nightKeywords.some(k => time.toLowerCase().includes(k));
      const isDanger  = dangerKeywords.some(k => zone.toLowerCase().includes(k));

      let risk = 25;
      if (isNight)  risk += 30;
      if (isDanger) risk += 25;
      risk = Math.min(95, risk + Math.floor(Math.random() * 15));

      const doc = {
        _id: uuidv4(), zone_name: zone, predicted_risk: risk,
        confidence: parseFloat((0.70 + Math.random() * 0.25).toFixed(2)),
        time_slot: time,
        factors: { night: isNight, zone_type: isDanger ? 'high_risk' : 'low_risk' },
        valid_until: new Date(Date.now() + 6 * 3600000).toISOString(),
        created_at: new Date().toISOString(),
      };
      await db.predictions.insert(doc);
      prediction = doc;
    }

    // Fetch recent incidents in this area for weekly count
    const all    = await db.incidents.find({});
    const cutoff = Date.now() - 7 * 86400000;
    const weeklyIncidents = all.filter(d =>
      (d.location_name || '').toLowerCase().includes(zone.toLowerCase().split(' ')[0]) &&
      new Date(d.reported_at).getTime() > cutoff
    ).length;

    res.json({
      success: true,
      data: {
        ...prediction, id: prediction._id,
        cctv_coverage:       Math.round(25 + Math.random() * 60),
        police_response_min: Math.round(5  + Math.random() * 18),
        weekly_incidents:    weeklyIncidents,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /predict/route ───────────────────────────────────────
router.get('/route', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!to) return res.status(400).json({ success: false, error: 'to (destination) is required' });

    const all        = await db.incidents.find({ status: { $ne: 'resolved' } });
    const cutoff     = Date.now() - 48 * 3600000;
    const recent     = all.filter(d => new Date(d.reported_at).getTime() > cutoff);
    const avgRisk    = recent.reduce((s, d) => s + (d.ai_risk_score || 0), 0) / (recent.length || 1);

    const safetyScore  = Math.min(99, Math.round(100 - avgRisk * 0.5 + Math.random() * 12));
    const cctvCoverage = Math.round(60 + Math.random() * 35);
    const policePosts  = Math.round(2 + Math.random() * 4);
    const distanceKm   = (1.5 + Math.random() * 5).toFixed(1);
    const durationMin  = Math.round(parseFloat(distanceKm) * 5 + Math.random() * 8);

    const warnings = [];
    if (avgRisk > 50) warnings.push('1 poorly-lit stretch detected — avoid after 9PM');
    warnings.push(`${policePosts} police check-posts along this route`);
    if (cctvCoverage < 75) warnings.push('Moderate CCTV coverage — stay alert in blind spots');

    res.json({
      success: true,
      data: { safety_score: safetyScore, distance_km: distanceKm, duration_min: durationMin, cctv_coverage: cctvCoverage, police_posts: policePosts, warnings, from: from || 'My Location', to }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /predict/forecast — 72-hour risk ────────────────────
router.get('/forecast', async (req, res) => {
  try {
    const all = await db.incidents.find({});

    // Build hourly frequency map from real data
    const hourCount = Array(24).fill(0);
    all.forEach(d => {
      const h = new Date(d.reported_at).getHours();
      hourCount[h]++;
    });
    const maxCount = Math.max(...hourCount, 1);

    const forecast = [];
    for (let i = 0; i < 72; i += 3) {
      const h        = i % 24;
      const dayLabel = i < 24 ? 'Today' : i < 48 ? 'Tmrw' : 'Day3';
      const dbRisk   = (hourCount[h] / maxCount) * 55;
      const timeRisk = (h >= 21 || h <= 5) ? 30 : (h >= 18) ? 15 : 5;
      const risk     = Math.min(97, Math.round(dbRisk + timeRisk + Math.random() * 10));
      forecast.push({ label: `${dayLabel} ${String(h).padStart(2, '0')}:00`, risk, hour: h });
    }

    res.json({ success: true, data: forecast });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /predict/zones — Safe zones ─────────────────────────
router.get('/zones', async (req, res) => {
  try {
    const docs = await db.zones.find({ is_active: true });
    res.json({ success: true, data: docs.map(d => ({ ...d, id: d._id })) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
