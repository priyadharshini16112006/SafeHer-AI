/* ============================================================
   SafeHer AI — NeDB Database Setup & Seeder
   Pure JavaScript — No native compilation required
   database.js
   ============================================================ */

const Datastore = require('nedb-promises');
const path      = require('path');
const fs        = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Create datastores (auto-persisted to files) ──────────────
const db = {
  incidents:   Datastore.create({ filename: path.join(DATA_DIR, 'incidents.db'),   autoload: true }),
  users:       Datastore.create({ filename: path.join(DATA_DIR, 'users.db'),       autoload: true }),
  sos:         Datastore.create({ filename: path.join(DATA_DIR, 'sos.db'),         autoload: true }),
  posts:       Datastore.create({ filename: path.join(DATA_DIR, 'posts.db'),       autoload: true }),
  zones:       Datastore.create({ filename: path.join(DATA_DIR, 'zones.db'),       autoload: true }),
  predictions: Datastore.create({ filename: path.join(DATA_DIR, 'predictions.db'), autoload: true }),
};

// ─── Seed sample data (only if collections are empty) ───────────
async function seedData() {
  const count = await db.incidents.count({});
  if (count > 0) {
    console.log('ℹ️  Database already seeded');
    // Ensure existing users (from earlier sample seeds) have hashed passwords
    try {
      const users = await db.users.find({});
      for (const u of users) {
        if (u.password && typeof u.password === 'string' && !u.password.startsWith('$2')) {
          const hashed = await bcrypt.hash(u.password, BCRYPT_ROUNDS);
          await db.users.update({ _id: u._id }, { $set: { password: hashed } });
          console.log(`🔐 Migrated password to bcrypt for ${u.email || u._id}`);
        }
      }
    } catch (err) {
      console.warn('⚠️  User migration failed, continuing startup:', err.message);
    }

    const userCount = await db.users.count({});
    if (userCount === 0) {
      const passwordHash = await bcrypt.hash('password123', BCRYPT_ROUNDS);
      await db.users.insert([
        {
          _id: uuidv4(),
          name: 'Priya Sharma',
          email: 'priya@safeher.ai',
          password: passwordHash,
          phone: '9876543210',
          role: 'user',
          avatar: 'PS',
          created_at: new Date().toISOString(),
        },
        {
          _id: uuidv4(),
          name: 'Inspector Rathod',
          email: 'inspector@safeher.ai',
          password: passwordHash,
          phone: '9988776655',
          role: 'police',
          avatar: 'IR',
          created_at: new Date().toISOString(),
        },
        {
          _id: uuidv4(),
          name: 'Neha Verma',
          email: 'ngo@safeher.ai',
          password: passwordHash,
          phone: '9123456789',
          role: 'ngo',
          avatar: 'NV',
          created_at: new Date().toISOString(),
        },
      ]);
      console.log('✅ Dev sample users seeded');
    }
    return;
  }
  const now = Date.now();
  const hoursAgo = (h) => new Date(now - h * 3600000).toISOString();

  // ── Incidents ──
  const incidentTypes = ['Harassment', 'Stalking', 'Assault', 'Suspicious Activity', 'Unsafe Zone', 'Eve-teasing'];
  const severities    = ['low', 'medium', 'high', 'critical'];
  const statuses      = ['active', 'investigating', 'resolved'];
  const locations = [
    { name: 'Central Market, Sector 3', lat: 28.6280, lng: 77.2120 },
    { name: 'Railway Station Road',     lat: 28.6430, lng: 77.2180 },
    { name: 'University Area Gate',     lat: 28.6100, lng: 77.2350 },
    { name: 'West Side Alley',          lat: 28.6200, lng: 77.1950 },
    { name: 'Bus Terminal North',       lat: 28.6350, lng: 77.2250 },
    { name: 'Industrial Zone Gate 3',   lat: 28.6050, lng: 77.2480 },
    { name: 'Night Bazaar Road',        lat: 28.6180, lng: 77.2090 },
    { name: 'Old Factory Road',         lat: 28.6320, lng: 77.1880 },
    { name: 'Metro Station East',       lat: 28.6250, lng: 77.2300 },
    { name: 'Shopping Mall Exit',       lat: 28.6150, lng: 77.2200 },
    { name: 'Park N-12 Entrance',       lat: 28.6400, lng: 77.2060 },
    { name: 'Vegetable Market',         lat: 28.6100, lng: 77.2140 },
    { name: 'Sector 12 Main Market',    lat: 28.6220, lng: 77.2070 },
    { name: 'Outer Ring Road Stretch',  lat: 28.5980, lng: 77.2200 },
    { name: 'Deserted Stretch Block F', lat: 28.6300, lng: 77.2400 },
  ];

  const incidentDocs = Array.from({ length: 60 }, () => {
    const loc      = locations[Math.floor(Math.random() * locations.length)];
    const type     = incidentTypes[Math.floor(Math.random() * incidentTypes.length)];
    const severity = severities[Math.floor(Math.random() * severities.length)];
    const status   = statuses[Math.floor(Math.random() * statuses.length)];
    const riskMap  = { critical: 87, high: 68, medium: 48, low: 22 };
    const ai_risk_score = Math.min(99, (riskMap[severity] || 50) + Math.floor(Math.random() * 12));
    return {
      _id: uuidv4(),
      type, severity, status, ai_risk_score,
      latitude:      loc.lat + (Math.random() - 0.5) * 0.01,
      longitude:     loc.lng + (Math.random() - 0.5) * 0.01,
      location_name: loc.name,
      description:   `Reported incident of ${type.toLowerCase()} in ${loc.name}`,
      is_anonymous:  Math.random() > 0.6,
      reported_at:   hoursAgo(Math.floor(Math.random() * 168)),
      resolved_at:   status === 'resolved' ? hoursAgo(Math.floor(Math.random() * 24)) : null,
    };
  });
  await db.incidents.insert(incidentDocs);

  // ── Safe Zones ──
  await db.zones.insert([
    { _id: uuidv4(), name: 'Women Police Station', type: 'police',    latitude: 28.6250, longitude: 77.2050, radius_meters: 300, is_active: true },
    { _id: uuidv4(), name: 'City Hospital',        type: 'hospital',  latitude: 28.6180, longitude: 77.2180, radius_meters: 250, is_active: true },
    { _id: uuidv4(), name: 'Community Safe Hub 1', type: 'community', latitude: 28.6320, longitude: 77.2110, radius_meters: 200, is_active: true },
    { _id: uuidv4(), name: 'Metro Station Safety', type: 'police',    latitude: 28.6400, longitude: 77.2230, radius_meters: 200, is_active: true },
    { _id: uuidv4(), name: 'Crisis Care Center',   type: 'hospital',  latitude: 28.6100, longitude: 77.2000, radius_meters: 200, is_active: true },
  ]);

  // ── Community Posts ──
  await db.posts.insert([
    { _id: uuidv4(), author_name: 'Priya Mehta',   author_initials: 'PM', location_name: 'Sector 12 Market',  content: 'Please be careful near the Sector 12 main market after 8PM. There were men following women today. Stay safe! 🙏', likes: 42, shares: 18, created_at: hoursAgo(1) },
    { _id: uuidv4(), author_name: 'Ananya Roy',     author_initials: 'AR', location_name: 'Central Bus Stand', content: 'The new CCTV installation at Central Bus Stand is a great initiative! Felt so much safer today. We need more of this!', likes: 87, shares: 34, created_at: hoursAgo(3) },
    { _id: uuidv4(), author_name: 'Sneha Kumar',    author_initials: 'SK', location_name: 'University Area',   content: 'Organizing a Women Safety Walk this Sunday at 6PM from university gate. Join us to reclaim our streets! 💪', likes: 156, shares: 89, created_at: hoursAgo(6) },
    { _id: uuidv4(), author_name: 'Rashmi Tiwari',  author_initials: 'RT', location_name: 'Industrial Zone',   content: 'ALERT: The stretch near Industrial Zone Gate 3 is extremely unsafe after sunset. Please use alternate route via Main Road.', likes: 203, shares: 145, created_at: hoursAgo(10) },
    { _id: uuidv4(), author_name: 'Kavita Singh',   author_initials: 'KS', location_name: 'City Center',       content: 'Kudos to the police for quick response! My SOS alert was responded to within 6 minutes. SafeHer AI saved my day! 🌟', likes: 312, shares: 67, created_at: hoursAgo(15) },
  ]);

  // ── Sample users removed for secure authentication ──
  // No sample accounts are created; production or dev users should register via the API.

  // ── Risk Predictions ──
  await db.predictions.insert([
    { _id: uuidv4(), zone_name: 'Central Market Area',      latitude: 28.6280, longitude: 77.2120, predicted_risk: 87, confidence: 0.91, time_slot: 'Tonight 9PM–12AM',          factors: { time: 'night', history: 'high', cctv: 'limited' },            valid_until: new Date(now + 86400000).toISOString(), created_at: new Date().toISOString() },
    { _id: uuidv4(), zone_name: 'Railway Station Approach', latitude: 28.6430, longitude: 77.2180, predicted_risk: 79, confidence: 0.85, time_slot: 'Tomorrow 11PM–2AM',          factors: { isolated: 'yes', lighting: 'poor', trains: 'late' },           valid_until: new Date(now + 86400000).toISOString(), created_at: new Date().toISOString() },
    { _id: uuidv4(), zone_name: 'Industrial Zone North',    latitude: 28.6050, longitude: 77.2480, predicted_risk: 71, confidence: 0.82, time_slot: 'Tomorrow 8PM–11PM',          factors: { shift_change: 'yes', isolated: 'yes' },                        valid_until: new Date(now + 86400000).toISOString(), created_at: new Date().toISOString() },
    { _id: uuidv4(), zone_name: 'West Market Lanes',        latitude: 28.6200, longitude: 77.1950, predicted_risk: 64, confidence: 0.78, time_slot: 'Day After Tomorrow 7PM–9PM', factors: { police_patrol: 'reduced', pattern: 'weekly' },                 valid_until: new Date(now + 86400000).toISOString(), created_at: new Date().toISOString() },
    { _id: uuidv4(), zone_name: 'University Back Road',     latitude: 28.6100, longitude: 77.2350, predicted_risk: 58, confidence: 0.74, time_slot: 'Tonight 10PM–1AM',           factors: { exam_hours: 'yes', lighting: 'limited' },                      valid_until: new Date(now + 86400000).toISOString(), created_at: new Date().toISOString() },
  ]);

  console.log('✅ Sample data seeded (60 incidents, 5 zones, 5 posts, 5 predictions)');
}

module.exports = { db, seedData };
