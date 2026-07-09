/* ============================================================
   SafeHer AI — Community Routes (NeDB)
   routes/community.js
   ============================================================ */

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db }  = require('../database');

// ─── GET /community/posts ─────────────────────────────────────
router.get('/posts', async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const docs  = await db.posts.find({}).sort({ created_at: -1 });
    const total = docs.length;
    const page  = docs.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    res.json({ success: true, data: page.map(d => ({ ...d, id: d._id })), total });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /community/posts ────────────────────────────────────
router.post('/posts', async (req, res) => {
  try {
    const { author_name, content, location_name, latitude, longitude } = req.body;
    if (!author_name || !content)
      return res.status(400).json({ success: false, error: 'author_name and content are required' });

    const initials = author_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const doc = {
      _id: uuidv4(), author_name, author_initials: initials,
      content, location_name: location_name || 'Unknown',
      latitude: latitude || null, longitude: longitude || null,
      likes: 0, shares: 0,
      created_at: new Date().toISOString(),
    };

    await db.posts.insert(doc);
    if (global.io) global.io.emit('community:new_post', { ...doc, id: doc._id });
    res.status(201).json({ success: true, data: { ...doc, id: doc._id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /community/posts/:id/like ──────────────────────────
router.post('/posts/:id/like', async (req, res) => {
  try {
    await db.posts.update({ _id: req.params.id }, { $inc: { likes: 1 } });
    const doc = await db.posts.findOne({ _id: req.params.id });
    if (!doc) return res.status(404).json({ success: false, error: 'Post not found' });
    res.json({ success: true, data: { id: doc._id, likes: doc.likes } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /community/posts/:id/share ─────────────────────────
router.post('/posts/:id/share', async (req, res) => {
  try {
    await db.posts.update({ _id: req.params.id }, { $inc: { shares: 1 } });
    const doc = await db.posts.findOne({ _id: req.params.id });
    res.json({ success: true, data: { likes: doc?.likes, shares: doc?.shares } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /community/champions ─────────────────────────────────
router.get('/champions', async (req, res) => {
  try {
    const docs = await db.posts.find({});
    const map  = {};
    docs.forEach(d => {
      if (!map[d.author_name]) map[d.author_name] = { author_name: d.author_name, author_initials: d.author_initials, posts: 0, total_likes: 0 };
      map[d.author_name].posts++;
      map[d.author_name].total_likes += d.likes || 0;
    });
    const champions = Object.values(map).sort((a, b) => b.total_likes - a.total_likes).slice(0, 5);
    res.json({ success: true, data: champions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
