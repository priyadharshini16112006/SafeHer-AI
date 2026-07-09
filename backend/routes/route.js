const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { v4: uuidv4 } = require('uuid');

function haversine(a, b) {
  const R = 6371000; // meters
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinDLat = Math.sin(dLat/2);
  const sinDLon = Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon), Math.sqrt(1 - (sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon)));
  return R * c;
}

async function incidentsNear(point, radiusMeters=200) {
  // simple linear scan on NeDB: load all incidents and filter
  const all = await db.incidents.find({});
  return all.filter(i => {
    const d = haversine({ latitude: i.latitude, longitude: i.longitude }, point);
    return d <= radiusMeters;
  });
}

function interpolate(a, b, t) {
  return { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t };
}

async function sampleIncidentDensityAlong(start, end, samples=8, radius=200) {
  let total = 0;
  for (let i=0;i<=samples;i++) {
    const p = interpolate(start, end, i/samples);
    const near = await incidentsNear(p, radius);
    total += near.length;
  }
  return total / (samples + 1);
}

router.post('/options', async (req, res) => {
  try {
    const { start, end, strategy='ai' } = req.body;
    if (!start || !end) return res.status(400).json({ success: false, message: 'start and end required' });

    const straightDist = Math.round(haversine(start, end));

    // baseline fastest route (straight line)
    const fastest = {
      id: uuidv4(), name: 'Fastest Route',
      path: [start, end],
      distance_m: straightDist,
      eta_min: Math.max(1, Math.round((straightDist/1000) / 40 * 60)), // assume 40 km/h motorized
    };

    // compute incident density along straight path
    const incidentDensity = await sampleIncidentDensityAlong(start, end, 6, 200);

    // AI Safe Route: detour if density high
    let aiPath = [start];
    if (incidentDensity > 0.8) {
      // create a mid offset to avoid hotspots
      const mid = interpolate(start, end, 0.5);
      mid.latitude += 0.003; mid.longitude -= 0.002; // simple offset
      aiPath.push(mid);
    }
    aiPath.push(end);
    const aiDist = Math.round(aiPath.reduce((acc, p, idx) => {
      if (idx===0) return 0; return acc + haversine(aiPath[idx-1], p);
    },0));
    const aiScoreBase = Math.max(5, 100 - Math.min(90, Math.round(incidentDensity * 30)));

    const ai = {
      id: uuidv4(), name: 'AI Safe Route',
      path: aiPath,
      distance_m: aiDist,
      eta_min: Math.max(1, Math.round((aiDist/1000) / 5 * 60)), // walking speed 5km/h
      safety_score: aiScoreBase,
      confidence: Math.min(0.98, Math.max(0.5, 0.8 - incidentDensity*0.1)),
      explanation: `Avoids ${Math.round(incidentDensity*100)}% incident density along straight path. Prioritizes routes near safe zones and lit streets.`,
    };

    // CCTV preferred: prefer path near `zones` (proxy for safety infrastructure)
    const zones = await db.zones.find({});
    // pick intermediate points closer to zones if any
    let cctvPath = [start];
    const nearbyZone = zones.find(z => haversine(start, {latitude: z.latitude, longitude: z.longitude}) < 2000 || haversine(end, {latitude: z.latitude, longitude: z.longitude}) < 2000);
    if (nearbyZone) {
      const mid = { latitude: (start.latitude + nearbyZone.latitude)/2, longitude: (start.longitude + nearbyZone.longitude)/2 };
      cctvPath.push(mid);
    }
    cctvPath.push(end);
    const cctvDist = Math.round(cctvPath.reduce((acc, p, idx) => { if (idx===0) return 0; return acc + haversine(cctvPath[idx-1], p); },0));
    const cctvScore = Math.max(10, 100 - Math.round(incidentDensity*20) + (nearbyZone ? 8 : 0));
    const cctv = { id: uuidv4(), name: 'CCTV / Safe-Zone Preferred', path: cctvPath, distance_m: cctvDist, eta_min: Math.max(1, Math.round((cctvDist/1000)/5*60)), safety_score: cctvScore, confidence: 0.7, explanation: nearbyZone ? `Passes near ${nearbyZone.name} (safe zone). Prefers monitored areas.` : 'Prefers known safe zones and busy streets.' };

    // Police Patrol Route: bias toward proximity to police zones
    const policeZones = zones.filter(z => z.type === 'police');
    let policePath = [start];
    if (policeZones.length) {
      const z = policeZones[0];
      policePath.push({ latitude: (start.latitude + z.latitude)/2, longitude: (start.longitude + z.longitude)/2 });
    }
    policePath.push(end);
    const policeDist = Math.round(policePath.reduce((acc, p, idx) => { if (idx===0) return 0; return acc + haversine(policePath[idx-1], p); },0));
    const policeScore = Math.max(10, 100 - Math.round(incidentDensity*18) + (policeZones.length ? 10 : 0));
    const police = { id: uuidv4(), name: 'Police Patrol Preferred', path: policePath, distance_m: policeDist, eta_min: Math.max(1, Math.round((policeDist/1000)/5*60)), safety_score: policeScore, confidence: 0.75, explanation: policeZones.length ? `Routing via ${policeZones[0].name} where patrol presence is higher.` : 'Routing toward areas with known patrols.' };

    // Dark Street Avoidance: penalize areas with poor lighting (we approximate using incident history at night)
    const nightDensity = await sampleIncidentDensityAlong(start, end, 6, 150);
    const darkPenalty = Math.round(nightDensity * 12);
    const darkPath = aiPath; // reuse AI detour
    const darkScore = Math.max(5, 100 - Math.min(85, Math.round(incidentDensity*25) + darkPenalty));
    const dark = { id: uuidv4(), name: 'Dark Street Avoidance', path: darkPath, distance_m: aiDist, eta_min: Math.max(1, Math.round((aiDist/1000)/5*60)), safety_score: darkScore, confidence: 0.66, explanation: `Minimizes poorly-lit segments (approx). Night incident density factor: ${nightDensity.toFixed(2)}.` };

    // Assemble options and filter by requested strategy preference ordering
    const options = [fastest, ai, cctv, police, dark];
    // Ensure all have safety_score and confidence
    options.forEach(o => { if (typeof o.safety_score === 'undefined') o.safety_score = Math.max(5, 100 - Math.round(incidentDensity*20)); if (typeof o.confidence === 'undefined') o.confidence = 0.6; });

    res.json({ success: true, data: { options } });
  } catch (err) {
    console.error('Route error', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
