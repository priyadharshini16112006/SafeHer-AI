/* ============================================================
   SafeHer AI — SOS Routes (NeDB)
   routes/sos.js
   ============================================================ */

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db }  = require('../database');

// ─── POST /sos/trigger ────────────────────────────────────────
router.post('/trigger', async (req, res) => {
  try {
    const { latitude, longitude, location_name, user_id, contacts = [] } = req.body;

    const doc = {
      _id:               uuidv4(),
      user_id:           user_id || null,
      latitude:          latitude  || 28.6139,
      longitude:         longitude || 77.2090,
      location_name:     location_name || 'Unknown Location',
      status:            'active',
      notified_contacts: contacts,
      triggered_at:      new Date().toISOString(),
      resolved_at:       null,
    };

    await db.sos.insert(doc);

    if (global.io) {
      global.io.emit('sos:broadcast', {
        id: doc._id,
        latitude: doc.latitude,
        longitude: doc.longitude,
        location_name: doc.location_name,
        triggered_at: doc.triggered_at,
        message: '🚨 SOS Alert Triggered! Woman needs help!',
      });
    }

    res.status(201).json({
      success: true,
      data: { ...doc, id: doc._id },
      message: 'SOS alert triggered. Emergency contacts & nearest police notified.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /sos/:id/update — live location update ──────────────
router.post('/:id/update', async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const id = req.params.id;
    const update = {};
    if (typeof latitude !== 'undefined') update.latitude = latitude;
    if (typeof longitude !== 'undefined') update.longitude = longitude;
    if (Object.keys(update).length === 0) return res.status(400).json({ success: false, message: 'No location provided.' });

    update.last_update = new Date().toISOString();
    await db.sos.update({ _id: id }, { $set: update });
    const doc = await db.sos.findOne({ _id: id });

    if (global.io) {
      global.io.emit('sos:update', { id: doc._id, latitude: doc.latitude, longitude: doc.longitude, last_update: doc.last_update });
    }

    res.json({ success: true, data: { ...doc, id: doc._id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /sos/:id/cancel ─────────────────────────────────────
router.post('/:id/cancel', async (req, res) => {
  try {
    await db.sos.update({ _id: req.params.id }, { $set: { status: 'cancelled', resolved_at: new Date().toISOString() } });
    const doc = await db.sos.findOne({ _id: req.params.id });
    if (global.io) global.io.emit('sos:cancelled', { id: req.params.id });
    res.json({ success: true, data: { ...doc, id: doc?._id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /sos/:id/status ──────────────────────────────────────
router.get('/:id/status', async (req, res) => {
  try {
    const doc = await db.sos.findOne({ _id: req.params.id });
    if (!doc) return res.status(404).json({ success: false, error: 'Alert not found' });
    res.json({ success: true, data: { ...doc, id: doc._id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /sos — All recent alerts ────────────────────────────
router.get('/', async (req, res) => {
  try {
    const docs = await db.sos.find({}).sort({ triggered_at: -1 });
    res.json({ success: true, data: docs.slice(0, 20).map(d => ({ ...d, id: d._id })) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
