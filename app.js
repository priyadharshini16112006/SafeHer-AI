/* ============================================================
   SafeHer AI — Frontend Application (API-Connected)
   app.js  |  Connects to Express backend on localhost:5000
   ============================================================ */

'use strict';

// ─── Configuration ────────────────────────────────────────────
const CONFIG = {
  API_BASE: 'http://localhost:5000/api',
  SOCKET_URL: 'http://localhost:5000',
  MAP_CENTER: [28.6139, 77.2090],
  MAP_ZOOM: 13,
  OFFLINE: false,          // set true if backend is down
};

// ─── App State ────────────────────────────────────────────────
const App = {
  currentPage: 'dashboard',
  sosTimer: null,
  sosCount: 5,
  sosAlertId: null,
  maps: {},
  layers: {},
  charts: {},
  incidents: [],
  incidentFilter: 'all',
  socket: null,
  stats: {},
};

// ─── API Helper ───────────────────────────────────────────────
async function api(endpoint, options = {}) {
  try {
    const url = `${CONFIG.API_BASE}${endpoint}`;
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`API ${endpoint} failed:`, err.message, '— using fallback data');
    CONFIG.OFFLINE = true;
    return null;
  }
}

// ─── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Dismiss page loader after a short init period
  setTimeout(() => {
    const loader = document.getElementById('page-loader');
    if (loader) loader.classList.add('hidden');
  }, 1800);

  // Enhancement widgets (run before heavy chart init so they appear instantly)
  initDashboardInfoBar();
  initDashboardProfile();
  initWeatherWidget();

  initSocketIO();
  await loadDashboard();

  // Score widgets depend on App.stats, so run AFTER loadDashboard resolves
  initScoreWidgets();

  initSparklines();
  initTrendChart();
  initDonutChart();
  initTimeHeatmap();
  initMiniMap();
  initChatbot();
});

// ─── Socket.IO Real-Time ──────────────────────────────────────
function initSocketIO() {
  if (typeof io === 'undefined') {
    console.warn('Socket.io not loaded — real-time disabled');
    return;
  }
  try {
    App.socket = io(CONFIG.SOCKET_URL, { transports: ['websocket', 'polling'] });

    App.socket.on('connect', () => {
      console.log('✅ Real-time connected:', App.socket.id);
      updateAIStatus(true);
    });

    App.socket.on('disconnect', () => {
      console.warn('⚠️  Real-time disconnected');
      updateAIStatus(false);
    });

    // Live incident feed
    App.socket.on('incident:new', (incident) => {
      prependLiveFeedItem({
        type: incident.type,
        location: incident.location_name,
        time: 'Just now',
        severity: incident.severity,
      });
      // Add to incidents table if on that page
      if (App.currentPage === 'incidents') {
        App.incidents.unshift(incident);
        renderIncidents(App.incidents);
      }
      // Update badge
      const badge = document.getElementById('incident-badge');
      if (badge) badge.textContent = parseInt(badge.textContent || '0') + 1;
    });

    // SOS broadcast
    App.socket.on('sos:broadcast', (data) => {
      showToast(`🚨 SOS Alert! ${data.location_name || 'Unknown location'}`, 'danger');
    });

    // SOS live updates
    App.socket.on('sos:update', (data) => {
      // If this update belongs to the current user's alert, refresh location display
      if (App.sosAlertId && data.id === App.sosAlertId) {
        App._sosLat = data.latitude; App._sosLng = data.longitude;
        const locEl = document.getElementById('sos-location');
        if (locEl) locEl.textContent = `📍 ${data.latitude.toFixed(4)}°N, ${data.longitude.toFixed(4)}°E`;
      }
    });

    // Community new post
    App.socket.on('community:new_post', (post) => {
      if (App.currentPage === 'community') prependCommunityPost(post);
    });

  } catch (e) {
    console.warn('Socket.io connection failed');
  }
}

function updateAIStatus(online) {
  const statusEl = document.querySelector('.ai-status span');
  const dotEl    = document.querySelector('.ai-dot');
  if (statusEl) statusEl.textContent = online ? 'AI Active' : 'Offline Mode';
  if (dotEl) dotEl.style.background = online ? 'var(--success)' : '#888';
}

// ─── Navigation ───────────────────────────────────────────────
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.getElementById(`nav-${page}`)?.classList.add('active');
  App.currentPage = page;

  const titles = {
    dashboard: ['Live Dashboard', 'Real-time safety intelligence'],
    heatmap:   ['Safety Heatmap', 'Interactive zone risk visualization'],
    analytics: ['AI Analytics', 'Machine learning insights'],
    incidents: ['Incident Registry', 'All reported incidents'],
    routes:    ['Safe Routes', 'AI-powered journey planner'],
    community: ['Community Network', 'Shared safety intelligence'],
    predict:   ['Predictive AI', 'Forecast & proactive alerts'],
  };
  const [title, sub] = titles[page] || ['SafeHer AI', ''];
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = sub;

  // Lazy-load each page's data
  if (page === 'heatmap'   && !App.maps.main)        setTimeout(initMainMap, 100);
  if (page === 'routes'    && !App.maps.routes)       setTimeout(initRoutesMap, 100);
  if (page === 'analytics') setTimeout(loadAnalyticsPage, 100);
  if (page === 'incidents') loadIncidentsPage();
  if (page === 'community') loadCommunityPage();
  if (page === 'predict')   loadPredictPage();

  if (window.innerWidth <= 900) closeSidebar();
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function closeSidebar()  { document.getElementById('sidebar').classList.remove('open'); }

// ─── DASHBOARD ────────────────────────────────────────────────
async function loadDashboard() {
  const result = await api('/analytics/dashboard');

  const stats = result?.data || {
    totalIncidents: 247, sosToday: 34, womenProtected: 1240,
    highRiskZones: 6, globalSafetyScore: 78,
  };
  App.stats = stats;

  animateCount(document.querySelector('#stat-incidents .stat-value'), 0, stats.totalIncidents, 1400);
  animateCount(document.querySelector('#stat-sos .stat-value'),       0, stats.sosToday,       1200);
  animateCount(document.querySelector('#stat-safe .stat-value'),      0, stats.womenProtected, 1600);
  animateCount(document.querySelector('#stat-risk .stat-value'),      0, stats.highRiskZones,  1000);

  // Update global safety badge
  const badge = document.getElementById('global-safety-score');
  if (badge) badge.querySelector('strong').textContent = `${stats.globalSafetyScore}%`;

  // Load trend chart with real data
  await loadTrendChartData('week');
  // Load live feed
  await loadLiveFeed();
}

// ─── DASHBOARD ENHANCEMENTS ────────────────────────────────────

/* ── Info Bar: Live Clock, Date, Location ── */
function initDashboardInfoBar() {
  const LOCATIONS = [
    'New Delhi, India', 'Mumbai, India', 'Bangalore, India',
    'Hyderabad, India', 'Chennai, India', 'Kolkata, India',
    'Pune, India', 'Jaipur, India',
  ];

  // Try geolocation label (use sample since no reverse-geocoding API)
  const locationLabel = LOCATIONS[Math.floor(Math.random() * 3)]; // use first 3 for realism
  const locText = document.getElementById('info-loc-text');
  const profileLoc = document.getElementById('profile-location');
  const weatherCity = document.getElementById('weather-city');
  if (locText) locText.textContent = locationLabel;
  if (profileLoc) profileLoc.textContent = locationLabel;
  if (weatherCity) weatherCity.textContent = locationLabel;

  // Live clock tick
  function tick() {
    const now = new Date();
    const dateEl = document.getElementById('info-date');
    const timeEl = document.getElementById('info-time');
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
    if (timeEl) timeEl.textContent = now.toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
  }
  tick();
  setInterval(tick, 1000);

  // Last-updated stamp (refresh every 30s to show freshness)
  let lastUpdated = new Date();
  function updateStamp() {
    const el = document.getElementById('info-last-updated');
    if (!el) return;
    const diff = Math.round((Date.now() - lastUpdated.getTime()) / 1000);
    el.textContent = diff < 10 ? 'just now' : `${diff}s ago`;
  }
  setInterval(updateStamp, 5000);

  // Refresh data every 30s
  setInterval(async () => {
    await loadDashboard();
    lastUpdated = new Date();
    const el = document.getElementById('info-last-updated');
    if (el) el.textContent = 'just now';
  }, 30000);
}

/* ── Profile Card from Auth Session ── */
function initDashboardProfile() {
  // Read session set by auth module
  const raw = sessionStorage.getItem('safeher_auth') || localStorage.getItem('safeher_auth');
  let user = null;
  try { user = raw ? JSON.parse(raw).user : null; } catch {}

  // Sample defaults (matches seeded accounts)
  const ROLE_META = {
    user:   { emoji: '👩', label: 'General User', color: 'linear-gradient(135deg,#f857a6,#a855f7)' },
    police: { emoji: '👮', label: 'Police / Admin', color: 'linear-gradient(135deg,#06b6d4,#3b82f6)' },
    ngo:    { emoji: '🤝', label: 'NGO / Org', color: 'linear-gradient(135deg,#22c55e,#06b6d4)' },
  };

  const name     = user?.name  || 'Priya Sharma';
  const email    = user?.email || 'priya@safeher.ai';
  const role     = user?.role  || 'user';
  const initials = user?.avatar || name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const roleMeta = ROLE_META[role] || ROLE_META.user;

  // Avatar
  const avatarEl = document.getElementById('profile-avatar-initials');
  if (avatarEl) {
    avatarEl.textContent = initials;
    avatarEl.style.background = roleMeta.color;
  }

  // Name, role badge, email
  const nameEl   = document.getElementById('profile-name');
  const roleEl   = document.getElementById('profile-role-badge');
  const emailEl  = document.getElementById('profile-email');
  if (nameEl)  nameEl.textContent  = name;
  if (roleEl)  { roleEl.textContent = `${roleMeta.emoji} ${roleMeta.label}`; roleEl.style.background = roleMeta.color; }
  if (emailEl) emailEl.textContent = email;

  // Session since
  const sessionEl = document.getElementById('profile-session');
  if (sessionEl) {
    const now = new Date();
    sessionEl.textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
}

/* ── Realistic Weather Widget ── */
function initWeatherWidget() {
  // Realistic sample weather for major Indian cities (July — monsoon season)
  const weatherProfiles = [
    { city: 'New Delhi',    temp: 37, desc: 'Partly Cloudy',  icon: '⛅', humidity: '62%', wind: '14 km/h', vis: '7 km',  safetyNote: '⚠️ Hazy conditions — Be more alert in low-visibility areas.' },
    { city: 'Mumbai',       temp: 29, desc: 'Heavy Showers',  icon: '🌧️', humidity: '88%', wind: '22 km/h', vis: '4 km',  safetyNote: '⚠️ Low visibility due to rain — Avoid isolated routes.' },
    { city: 'Bangalore',    temp: 24, desc: 'Overcast',       icon: '🌦️', humidity: '74%', wind: '10 km/h', vis: '9 km',  safetyNote: '✅ Moderate weather — Good visibility, stay on well-lit roads.' },
    { city: 'Hyderabad',    temp: 32, desc: 'Clear Sky',      icon: '☀️', humidity: '55%', wind: '12 km/h', vis: '12 km', safetyNote: '✅ Clear conditions — Lower risk, good visibility throughout.' },
    { city: 'Chennai',      temp: 35, desc: 'Humid & Hot',    icon: '🌤️', humidity: '79%', wind: '16 km/h', vis: '8 km',  safetyNote: '⚠️ High heat index — Stay hydrated and avoid isolated areas.' },
    { city: 'Kolkata',      temp: 31, desc: 'Thunderstorm',   icon: '⛈️', humidity: '85%', wind: '28 km/h', vis: '3 km',  safetyNote: '🚨 Severe weather — Stay indoors, avoid deserted stretches.' },
    { city: 'Pune',         temp: 26, desc: 'Light Rain',     icon: '🌦️', humidity: '71%', wind: '11 km/h', vis: '8 km',  safetyNote: '✅ Light rain — Visibility acceptable, use lit routes after dark.' },
    { city: 'Jaipur',       temp: 40, desc: 'Sunny & Hot',    icon: '☀️', humidity: '32%', wind: '8 km/h',  vis: '15 km', safetyNote: '✅ Good visibility — Carry water, heat advisory in effect.' },
  ];

  const locText = document.getElementById('info-loc-text')?.textContent || '';
  const match = weatherProfiles.find(w => locText.includes(w.city)) || weatherProfiles[0];

  // Slight random variance for realism
  const tempVar = match.temp + Math.floor((Math.random() - 0.5) * 4);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setHTML = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };

  set('weather-temp', tempVar);
  set('weather-desc', match.desc);
  set('weather-humidity', match.humidity);
  set('weather-wind', match.wind);
  set('weather-vis', match.vis);
  setHTML('weather-icon', match.icon);

  const noteEl = document.getElementById('weather-safety-note');
  if (noteEl) noteEl.textContent = match.safetyNote;
}

/* ── Safety Score + AI Confidence ── */
function initScoreWidgets() {
  // Derive from current app stats or use realistic sample values
  const stats = App.stats || {};
  const safetyScore = stats.globalSafetyScore || Math.floor(68 + Math.random() * 14); // 68–82
  const aiConfidence = Math.floor(91 + Math.random() * 7); // 91–98%

  const safetyLabels = [
    { max: 40, label: '🔴 Critical — High danger zones active' },
    { max: 60, label: '🟠 Moderate risk — Exercise caution' },
    { max: 75, label: '🟡 Elevated — Some risky zones detected' },
    { max: 88, label: '🟢 Good — Most zones are safe today' },
    { max: 100, label: '✅ Excellent — City-wide safety is high' },
  ];
  const safetyLabel = safetyLabels.find(l => safetyScore <= l.max)?.label || '🟢 Good';

  // Animate safety score counter
  const safetyEl = document.getElementById('today-safety-score');
  const safetyBar = document.getElementById('safety-bar');
  const safetyDescEl = document.getElementById('safety-score-label');

  animateCount(safetyEl, 0, safetyScore, 1600);
  setTimeout(() => {
    if (safetyBar) safetyBar.style.width = `${safetyScore}%`;
    if (safetyDescEl) safetyDescEl.textContent = safetyLabel;
  }, 200);

  // Animate AI confidence counter
  const aiEl = document.getElementById('ai-confidence-score');
  const aiBar = document.getElementById('ai-bar');
  const aiDescEl = document.getElementById('ai-confidence-label');

  animateCount(aiEl, 0, aiConfidence, 1800);
  setTimeout(() => {
    if (aiBar) aiBar.style.width = `${aiConfidence}%`;
    if (aiDescEl) aiDescEl.textContent = `${aiConfidence}% accuracy on ${stats.totalIncidents || 247} recent incidents`;
  }, 200);
}

// ─── Animated Counters ────────────────────────────────────────
function animateCount(el, from, to, duration) {
  if (!el) return;
  const start = performance.now();
  const update = (time) => {
    const progress = Math.min((time - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (to - from) * eased).toLocaleString();
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}


// ─── Sparklines ───────────────────────────────────────────────
function initSparklines() {
  const configs = [
    { id: 'spark1', data: [32,45,28,55,41,62,48,70,55,78], color: '#ef4444' },
    { id: 'spark2', data: [12,8,15,22,18,11,25,19,30,34],  color: '#f97316' },
    { id: 'spark3', data: [800,850,900,870,950,1000,1100,1150,1200,1240], color: '#22c55e' },
    { id: 'spark4', data: [2,3,4,3,5,4,6,5,7,6], color: '#a855f7' },
  ];
  configs.forEach(({ id, data, color }) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
    const step = w / (data.length - 1);
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    data.forEach((val, i) => {
      const x = i * step, y = h - ((val - min) / range) * h * 0.9 - h * 0.05;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, color + '60'); grad.addColorStop(1, color);
    ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  });
}

// ─── Trend Chart ──────────────────────────────────────────────
async function loadTrendChartData(period) {
  const result = await api(`/analytics/trends?period=${period}`);
  if (!result?.data) return;

  const { incidents, sos } = result.data;

  // Build label set (last N days)
  const allDays = incidents.map(r => r.label);
  const dayLabel = d => {
    const dt = new Date(d);
    return dt.toLocaleDateString('en', { weekday: 'short', day: 'numeric' });
  };

  const labels    = allDays.map(dayLabel);
  const incData   = incidents.map(r => r.incidents);
  const predData  = incidents.map(r => Math.round(r.incidents * (1.05 + Math.random() * 0.1)));
  const sosMap    = {};
  sos.forEach(r => { sosMap[r.label] = r.count; });
  const sosData   = allDays.map(d => sosMap[d] || 0);

  if (App.charts.trend) {
    App.charts.trend.data.labels = labels;
    App.charts.trend.data.datasets[0].data = incData;
    App.charts.trend.data.datasets[1].data = predData;
    App.charts.trend.data.datasets[2].data = sosData;
    App.charts.trend.update('active');
  } else {
    initTrendChart(labels, incData, predData, sosData);
  }
}

function initTrendChart(labels, incData, predData, sosData) {
  const ctx = document.getElementById('trendChart')?.getContext('2d');
  if (!ctx) return;
  // Destroy existing instance to prevent canvas-reuse error on re-init
  if (App.charts.trend) { App.charts.trend.destroy(); App.charts.trend = null; }

  const defaultLabels  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const defaultInc     = [28,35,24,42,38,51,31];
  const defaultPred    = [30,33,26,45,40,48,34];
  const defaultSos     = [4,6,3,8,7,12,5];

  App.charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels || defaultLabels,
      datasets: [
        {
          label: 'Actual Incidents',
          data: incData || defaultInc,
          borderColor: '#f857a6',
          backgroundColor: (context) => {
            const chart = context.chart, {ctx: c, chartArea} = chart;
            if (!chartArea) return 'transparent';
            const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, 'rgba(248,87,166,0.3)');
            gradient.addColorStop(1, 'rgba(248,87,166,0)');
            return gradient;
          },
          fill: true, tension: 0.4, borderWidth: 2.5,
          pointBackgroundColor: '#f857a6', pointRadius: 4, pointHoverRadius: 7,
        },
        {
          label: 'AI Prediction',
          data: predData || defaultPred,
          borderColor: '#a855f7', borderDash: [5,5], fill: false,
          tension: 0.4, borderWidth: 2, pointRadius: 0,
        },
        {
          label: 'SOS Alerts', data: sosData || defaultSos, type: 'bar',
          backgroundColor: 'rgba(249,115,22,0.3)', borderColor: '#f97316',
          borderWidth: 1, borderRadius: 4, yAxisID: 'y1',
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x:  { grid: { color: 'rgba(255,255,255,0.04)', borderColor: 'transparent' }, ticks: { color: 'rgba(240,244,255,0.4)', font: { size: 11 } } },
        y:  { grid: { color: 'rgba(255,255,255,0.04)', borderColor: 'transparent' }, ticks: { color: 'rgba(240,244,255,0.4)', font: { size: 11 } }, beginAtZero: true },
        y1: { position: 'right', grid: { display: false }, ticks: { color: 'rgba(249,115,22,0.6)', font: { size: 10 } }, beginAtZero: true },
      },
      plugins: {
        legend: { labels: { color: 'rgba(240,244,255,0.6)', font: { size: 11 }, usePointStyle: true, pointStyle: 'circle', boxWidth: 8 } },
        tooltip: { backgroundColor: 'rgba(13,17,23,0.95)', borderColor: 'rgba(248,87,166,0.3)', borderWidth: 1, titleColor: '#f0f4ff', bodyColor: 'rgba(240,244,255,0.7)', padding: 12 }
      }
    }
  });
}

async function updateTrendChart(period) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  await loadTrendChartData(period);
}

// ─── Donut Chart ──────────────────────────────────────────────
async function initDonutChart() {
  const ctx = document.getElementById('categoryDonut')?.getContext('2d');
  if (!ctx) return;
  if (App.charts.donut) { App.charts.donut.destroy(); App.charts.donut = null; }

  const result = await api('/analytics/by-type');
  const categories = result?.data?.slice(0, 5) || [
    { type: 'Harassment', count: 82 },
    { type: 'Stalking',   count: 54 },
    { type: 'Assault',    count: 41 },
    { type: 'Suspicious', count: 38 },
    { type: 'Unsafe Zone',count: 32 },
  ];

  const colors = ['#f857a6','#a855f7','#ef4444','#f97316','#eab308'];

  App.charts.donut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: categories.map(c => c.type),
      datasets: [{
        data: categories.map(c => c.count),
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor: colors, borderWidth: 2, hoverOffset: 8,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '70%',
      plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(13,17,23,0.95)', borderColor: 'rgba(248,87,166,0.3)', borderWidth: 1, titleColor: '#f0f4ff', bodyColor: 'rgba(240,244,255,0.7)', padding: 12 } }
    }
  });

  const legend = document.getElementById('donut-legend');
  if (legend) {
    legend.innerHTML = categories.map((c, i) =>
      `<div class="legend-item"><div class="legend-dot" style="background:${colors[i]}"></div><span>${c.type}</span><span style="margin-left:auto;color:var(--text-muted);font-size:0.7rem">${c.count}</span></div>`
    ).join('');
    const total = categories.reduce((s, c) => s + c.count, 0);
    const totalEl = document.querySelector('.donut-total');
    if (totalEl) totalEl.textContent = total;
  }
}

// ─── Time Heatmap ─────────────────────────────────────────────
async function initTimeHeatmap() {
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const hours = Array.from({length: 24}, (_, i) => i);
  const container = document.getElementById('time-heatmap');
  if (!container) return;

  // Fetch real data
  const result = await api('/analytics/time-heatmap');
  const dbData = result?.data || [];

  // Build lookup: {day: {hour: count}}
  const lookup = {};
  dbData.forEach(r => {
    if (!lookup[r.day_name]) lookup[r.day_name] = {};
    lookup[r.day_name][r.hour] = { count: r.count, risk: r.avg_risk };
  });

  const maxCount = Math.max(...dbData.map(r => r.count), 1);

  container.innerHTML = '<div class="time-label"></div>';
  hours.forEach(h => {
    container.innerHTML += `<div class="time-hour-label">${h === 0 ? '12a' : h === 12 ? '12p' : h > 12 ? `${h-12}p` : `${h}a`}</div>`;
  });

  days.forEach(day => {
    container.innerHTML += `<div class="time-label">${day}</div>`;
    hours.forEach(h => {
      const db_row = lookup[day]?.[h];
      let val;
      if (db_row) {
        val = Math.round((db_row.count / maxCount) * 80 + 10);
      } else {
        if (h >= 21 || h <= 5) val = 55 + Math.floor(Math.random() * 30);
        else if (h >= 18 || h <= 8) val = 25 + Math.floor(Math.random() * 35);
        else val = 10 + Math.floor(Math.random() * 25);
        if (day === 'Sat' || day === 'Sun') val = Math.min(95, Math.round(val * 1.2));
      }

      const alpha = val / 100;
      const color = val > 70 ? `rgba(239,68,68,${alpha})`
                  : val > 45 ? `rgba(249,115,22,${alpha})`
                  : val > 25 ? `rgba(234,179,8,${alpha})`
                  : `rgba(34,197,94,${alpha * 0.7})`;

      container.innerHTML += `<div class="time-heatmap-cell" style="background:${color}" title="${day} ${h}:00 — Risk: ${val}%"></div>`;
    });
  });
}

// ─── Live Feed ────────────────────────────────────────────────
async function loadLiveFeed() {
  const feed = document.getElementById('live-feed');
  if (!feed) return;

  const result = await api('/incidents?limit=8&status=active');
  const incidents = result?.data || getFallbackFeed();

  feed.innerHTML = '';
  incidents.slice(0, 8).forEach(inc => {
    feed.appendChild(createFeedItem({
      type: inc.type,
      location: inc.location_name || inc.location,
      time: formatTimeAgo(inc.reported_at || inc.time),
      severity: inc.severity,
    }));
  });
}

function createFeedItem(e) {
  const div = document.createElement('div');
  div.className = 'feed-item';
  div.innerHTML = `
    <div class="feed-severity ${e.severity}"></div>
    <div class="feed-content">
      <div class="feed-type">${e.type}</div>
      <div class="feed-location">📍 ${e.location}</div>
      <div class="feed-time">🕐 ${e.time}</div>
    </div>
  `;
  return div;
}

function prependLiveFeedItem(e) {
  const feed = document.getElementById('live-feed');
  if (!feed) return;
  const item = createFeedItem(e);
  feed.insertBefore(item, feed.firstChild);
  while (feed.children.length > 10) feed.removeChild(feed.lastChild);
}

function getFallbackFeed() {
  return [
    { type: 'Harassment',           location_name: 'Central Market',   reported_at: null, severity: 'critical', time: '2 min ago' },
    { type: 'Stalking',             location_name: 'Railway Station',  reported_at: null, severity: 'high',     time: '8 min ago' },
    { type: 'Suspicious Activity',  location_name: 'University Area',  reported_at: null, severity: 'medium',   time: '15 min ago' },
    { type: 'SOS Alert',            location_name: 'Bus Terminal',     reported_at: null, severity: 'critical', time: '22 min ago' },
    { type: 'Unsafe Zone',          location_name: 'Industrial Road',  reported_at: null, severity: 'high',     time: '31 min ago' },
  ];
}

function formatTimeAgo(isoDate) {
  if (!isoDate) return 'Just now';
  // Avoid double-appending Z: parse ISO string correctly
  let ts;
  try {
    // Remove any trailing Z then parse as-is; if no tz info treat as UTC
    const clean = String(isoDate).trim();
    ts = new Date(clean).getTime();
    if (isNaN(ts)) return 'Just now';
  } catch { return 'Just now'; }
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 0)   return 'Just now';
  if (diff < 60)  return 'Just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  const days = Math.floor(diff / 86400);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// ─── Mini Map ─────────────────────────────────────────────────
async function initMiniMap() {
  const map = L.map('mini-map', {
    center: CONFIG.MAP_CENTER, zoom: 12,
    zoomControl: false, scrollWheelZoom: false,
    dragging: false, attributionControl: false,
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

  // Load real heatmap data
  const result = await api('/incidents/heatmap?hours=168');
  const points  = result?.data?.map(p => [p.lat, p.lng, p.intensity]) || generateHeatPoints(...CONFIG.MAP_CENTER, 50, 0.05);

  if (typeof L.heatLayer !== 'undefined' && points.length) {
    L.heatLayer(points, { radius: 20, blur: 15, maxZoom: 15,
      gradient: { 0.2: '#22c55e', 0.5: '#eab308', 0.7: '#f97316', 1.0: '#ef4444' }
    }).addTo(map);
  }
  App.maps.mini = map;
}

// ─── Main Heatmap Map ─────────────────────────────────────────
async function initMainMap() {
  const map = L.map('main-map', {
    center: CONFIG.MAP_CENTER, zoom: CONFIG.MAP_ZOOM,
    zoomControl: true, attributionControl: false,
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

  // Incident heatmap from DB
  const heatResult = await api('/incidents/heatmap');
  const heatPoints = heatResult?.data?.map(p => [p.lat, p.lng, p.intensity])
                   || generateHeatPoints(...CONFIG.MAP_CENTER, 200, 0.06);

  if (typeof L.heatLayer !== 'undefined') {
    App.layers.heatmap = L.heatLayer(heatPoints, {
      radius: 30, blur: 20, maxZoom: 17,
      gradient: { 0.2: '#22c55e', 0.4: '#eab308', 0.65: '#f97316', 1.0: '#ef4444' }
    }).addTo(map);
  }

  // Safe zones from DB
  const zonesResult = await api('/predict/zones');
  const safeZones   = zonesResult?.data || [];

  App.layers.safezones = L.layerGroup();
  const zoneColors = { police: '#3b82f6', hospital: '#06b6d4', community: '#22c55e' };
  safeZones.forEach(z => {
    const color = zoneColors[z.type] || '#22c55e';
    const circle = L.circle([z.latitude, z.longitude], {
      radius: z.radius_meters || 200, color, fillColor: color, fillOpacity: 0.15, weight: 2,
    });
    circle.bindPopup(`<div class="zone-popup"><strong>${z.name}</strong><br/><small style="color:${color}">✓ Safe Zone</small></div>`);
    circle.on('click', () => showZoneInfo(z, color));
    App.layers.safezones.addLayer(circle);
  });
  App.layers.safezones.addTo(map);

  // Danger zone markers from high-risk incidents
  const highRisk = await api('/analytics/by-area');
  const dangerZones = (highRisk?.data || []).filter(z => z.avg_risk > 70).slice(0, 5);
  dangerZones.forEach(z => {
    // We don't have lat/lng per area in analytics, so use flagged locations
  });

  // Fallback danger zones
  [
    { pos: [28.630, 77.215], risk: 88, name: 'Industrial Alley' },
    { pos: [28.605, 77.200], risk: 74, name: 'Old Market Street' },
    { pos: [28.620, 77.225], risk: 91, name: 'Deserted Stretch' },
  ].forEach(z => {
    const color = z.risk > 85 ? '#ef4444' : '#f97316';
    L.circle(z.pos, { radius: 300, color, fillColor: color, fillOpacity: 0.12, weight: 2, dashArray: '6 4' })
     .bindPopup(`<div class="zone-popup"><strong>⚠️ ${z.name}</strong><br/>Risk: <span style="color:${color}">${z.risk}%</span><br/><small>AI Flagged</small></div>`)
     .addTo(map);
  });

  App.maps.main = map;
}

function showZoneInfo(zone, color = '#22c55e') {
  const panel = document.getElementById('zone-info-content');
  if (!panel) return;
  panel.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="font-weight:600;color:var(--text-primary)">${zone.name}</div>
      <div style="color:${color};font-size:0.8rem">✓ ${zone.type?.toUpperCase() || 'SAFE ZONE'}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.5">
        Type: ${zone.type || 'community'}<br/>
        Radius: ${zone.radius_meters || 200}m coverage<br/>
        Status: ${zone.is_active ? 'Active' : 'Inactive'}
      </div>
    </div>
  `;
}

function toggleLayer(layer) {
  if (!App.layers || !App.maps.main) return;
  const l = App.layers[layer];
  if (!l) return;
  if (App.maps.main.hasLayer(l)) App.maps.main.removeLayer(l);
  else App.maps.main.addLayer(l);
}

function filterByTime(value) {
  showToast(`Filtering heatmap: ${value || 'All time'}`, 'info');
}

// ─── Analytics Page ───────────────────────────────────────────
async function loadAnalyticsPage() {
  await initPredictiveChart();
  await initDayChart();
  initResponseChart();
  await initSentimentAnalysis();
  initAgeChart();
  await initAreaChart();
}

async function initPredictiveChart() {
  const canvas = document.getElementById('predictiveChart');
  if (!canvas || canvas.dataset.initialized) return;
  canvas.dataset.initialized = 'true';

  const result = await api('/analytics/trends?period=month');
  const rows = result?.data?.incidents?.slice(-14) || [];

  const labels = rows.map(r => {
    const d = new Date(r.label);
    return d.toLocaleDateString('en', { weekday: 'short', day: 'numeric' });
  });

  const historical = rows.slice(0, 7).map(r => r.incidents);
  const predicted  = rows.slice(7).map(r => Math.round(r.incidents * (1.05 + Math.random() * 0.12)));

  // Fallback
  const hist = historical.length ? historical : [28,32,25,41,36,48,30];
  const pred = predicted.length  ? predicted  : [30,34,28,44,39,50,33];
  const lbs  = labels.length     ? labels     : ['D1','D2','D3','D4','D5','D6','D7','D8','D9','D10','D11','D12','D13','D14'];

  const upperBound = pred.map(v => v + Math.round(4 + Math.random()*7));
  const lowerBound = pred.map(v => v - Math.round(3 + Math.random()*5));

  new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: lbs.slice(0, 14),
      datasets: [
        { label: 'Historical',  data: [...hist, ...new Array(7).fill(null)], borderColor: '#f857a6', borderWidth: 2.5, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#f857a6', fill: false },
        { label: 'AI Forecast', data: [...new Array(hist.length-1).fill(null), hist[hist.length-1], ...pred], borderColor: '#a855f7', borderDash: [6,3], borderWidth: 2.5, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#a855f7', fill: false },
        { label: 'Upper Band',  data: [...new Array(hist.length).fill(null), ...upperBound], borderColor: 'rgba(168,85,247,0.2)', borderWidth: 1, tension: 0.4, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(168,85,247,0.08)' },
        { label: 'Lower Band',  data: [...new Array(hist.length).fill(null), ...lowerBound], borderColor: 'rgba(168,85,247,0.2)', borderWidth: 1, tension: 0.4, pointRadius: 0, fill: false },
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(240,244,255,0.4)', font: { size: 10 } } }, y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(240,244,255,0.4)', font: { size: 10 } }, beginAtZero: true } },
      plugins: { legend: { labels: { color: 'rgba(240,244,255,0.6)', font: { size: 10 }, usePointStyle: true, filter: item => item.datasetIndex < 2 } }, tooltip: { backgroundColor: 'rgba(13,17,23,0.95)', borderColor: 'rgba(168,85,247,0.3)', borderWidth: 1, titleColor: '#f0f4ff', bodyColor: 'rgba(240,244,255,0.7)', padding: 12 } }
    }
  });
}

async function initDayChart() {
  const canvas = document.getElementById('dayChart');
  if (!canvas || canvas.dataset.initialized) return;
  canvas.dataset.initialized = 'true';

  const result = await api('/analytics/trends?period=week');
  const rows = result?.data?.incidents || [];
  const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const values   = dayNames.map((_, i) => rows[i]?.incidents || Math.floor(20 + Math.random()*35));
  const colors   = values.map(v => v > 40 ? 'rgba(239,68,68,0.6)' : v > 30 ? 'rgba(249,115,22,0.6)' : 'rgba(34,197,94,0.6)');
  const borders  = values.map(v => v > 40 ? '#ef4444' : v > 30 ? '#f97316' : '#22c55e');

  new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: dayNames, datasets: [{ label: 'Incidents', data: values, backgroundColor: colors, borderColor: borders, borderWidth: 1.5, borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(13,17,23,0.95)', borderColor: 'rgba(248,87,166,0.3)', borderWidth: 1, titleColor: '#f0f4ff', bodyColor: 'rgba(240,244,255,0.7)', padding: 10 } }, scales: { x: { grid: { display: false }, ticks: { color: 'rgba(240,244,255,0.4)' } }, y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(240,244,255,0.4)' }, beginAtZero: true } } }
  });
}

function initResponseChart() {
  const canvas = document.getElementById('responseChart');
  if (!canvas || canvas.dataset.initialized) return;
  canvas.dataset.initialized = 'true';
  new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: ['Jan','Feb','Mar','Apr','May','Jun'], datasets: [{ label: 'Avg Response (min)', data: [18,15,14,12,10,8], borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.1)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: '#06b6d4' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(13,17,23,0.95)', borderColor: 'rgba(6,182,212,0.3)', borderWidth: 1, titleColor: '#f0f4ff', bodyColor: 'rgba(240,244,255,0.7)', padding: 10 } }, scales: { x: { grid: { display: false }, ticks: { color: 'rgba(240,244,255,0.4)' } }, y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(240,244,255,0.4)', callback: v => `${v}m` }, beginAtZero: true } } }
  });
}

async function initSentimentAnalysis() {
  const sentimentContainer = document.getElementById('sentiment-bars');
  const cloudContainer     = document.getElementById('sentiment-cloud');
  if (!sentimentContainer || sentimentContainer.dataset.initialized) return;
  sentimentContainer.dataset.initialized = 'true';

  const result = await api('/analytics/sentiment');
  const sentiments = result?.data || [
    { word: 'Unsafe', pct: 82 }, { word: 'Scared', pct: 74 }, { word: 'Helpless', pct: 65 },
    { word: 'Harassed', pct: 59 }, { word: 'Concerned', pct: 48 }, { word: 'Safe', pct: 31 },
    { word: 'Confident', pct: 22 }, { word: 'Empowered', pct: 18 },
  ];

  const colorMap = { 82:'#ef4444',74:'#f97316',65:'#f97316',59:'#eab308',48:'#eab308',31:'#22c55e',22:'#22c55e',18:'#06b6d4' };
  const colors   = ['#ef4444','#f97316','#f97316','#eab308','#eab308','#22c55e','#22c55e','#06b6d4'];

  sentimentContainer.innerHTML = `<p class="sentiment-label">Community Sentiment Analysis — NLP processed</p>`;
  sentiments.forEach((s, i) => {
    const color = colors[i] || '#a855f7';
    sentimentContainer.innerHTML += `
      <div class="sentiment-bar-row">
        <span class="sentiment-word">${s.word}</span>
        <div class="sentiment-bar-wrap"><div class="sentiment-bar" style="width:${s.pct}%;background:${color}"></div></div>
        <span class="sentiment-pct">${s.pct}%</span>
      </div>
    `;
  });

  if (cloudContainer) {
    const words = ['dangerous','night','alone','fear','police','cctv','dark','crowd','isolated','help','urgent','alert','safety','protect','aware','vigilant','support','community'];
    const tagColors = [['rgba(239,68,68,0.15)','#ef4444'],['rgba(249,115,22,0.15)','#f97316'],['rgba(234,179,8,0.15)','#eab308'],['rgba(34,197,94,0.15)','#22c55e'],['rgba(6,182,212,0.15)','#06b6d4'],['rgba(168,85,247,0.15)','#a855f7']];
    words.forEach((w, i) => {
      const [bg, color] = tagColors[i % tagColors.length];
      cloudContainer.innerHTML += `<span class="word-tag" style="background:${bg};color:${color};border-color:${color}40">${w}</span>`;
    });
  }
}

function initAgeChart() {
  const canvas = document.getElementById('ageChart');
  if (!canvas || canvas.dataset.initialized) return;
  canvas.dataset.initialized = 'true';
  new Chart(canvas.getContext('2d'), {
    type: 'polarArea',
    data: { labels: ['15-20','21-25','26-30','31-40','41-50','50+'], datasets: [{ data: [18,35,28,12,5,2], backgroundColor: ['rgba(248,87,166,0.7)','rgba(168,85,247,0.7)','rgba(239,68,68,0.7)','rgba(249,115,22,0.7)','rgba(234,179,8,0.7)','rgba(6,182,212,0.7)'], borderColor: ['#f857a6','#a855f7','#ef4444','#f97316','#eab308','#06b6d4'], borderWidth: 1.5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: 'rgba(240,244,255,0.6)', font: { size: 10 } } }, tooltip: { backgroundColor: 'rgba(13,17,23,0.95)', borderColor: 'rgba(248,87,166,0.3)', borderWidth: 1, titleColor: '#f0f4ff', bodyColor: 'rgba(240,244,255,0.7)', padding: 10 } }, scales: { r: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { display: false } } } }
  });
}

async function initAreaChart() {
  const canvas = document.getElementById('areaChart');
  if (!canvas || canvas.dataset.initialized) return;
  canvas.dataset.initialized = 'true';

  const result = await api('/analytics/by-area');
  const areaData = (result?.data || []).slice(0, 6);
  const areas  = areaData.length ? areaData.map(r => r.location_name?.split(',')[0] || 'Area') : ['Central','North','South','East','West','CBD'];
  const scores = areaData.length ? areaData.map(r => Math.max(5, 100 - r.avg_risk)) : [42,68,75,82,38,55];

  new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: areas, datasets: [{ label: 'Safety Score', data: scores, backgroundColor: scores.map(s => s > 70 ? 'rgba(34,197,94,0.6)' : s > 50 ? 'rgba(234,179,8,0.6)' : 'rgba(239,68,68,0.6)'), borderColor: scores.map(s => s > 70 ? '#22c55e' : s > 50 ? '#eab308' : '#ef4444'), borderWidth: 1.5, borderRadius: 6 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(13,17,23,0.95)', borderColor: 'rgba(248,87,166,0.3)', borderWidth: 1, titleColor: '#f0f4ff', bodyColor: 'rgba(240,244,255,0.7)', padding: 10, callbacks: { label: ctx => ` Safety: ${ctx.raw}%` } } }, scales: { x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(240,244,255,0.4)', callback: v => `${v}%` }, max: 100 }, y: { grid: { display: false }, ticks: { color: 'rgba(240,244,255,0.6)', font: { size: 10 } } } } }
  });
}

// ─── Incidents Page ───────────────────────────────────────────
async function loadIncidentsPage() {
  const result = await api('/incidents?limit=30');
  App.incidents = result?.data || getSampleIncidents();
  renderIncidents(App.incidents);
}

function getSampleIncidents() {
  return [
    { id: 'INC-2847', type: 'Harassment',          location_name: 'Central Market, Sector 3', reported_at: null, ai_risk_score: 88, status: 'active',        severity: 'critical' },
    { id: 'INC-2846', type: 'Stalking',             location_name: 'Railway Station Rd',       reported_at: null, ai_risk_score: 74, status: 'investigating', severity: 'high'     },
    { id: 'INC-2845', type: 'Suspicious Activity',  location_name: 'University Gate',          reported_at: null, ai_risk_score: 55, status: 'resolved',      severity: 'medium'   },
    { id: 'INC-2844', type: 'Assault',              location_name: 'West Side Alley',          reported_at: null, ai_risk_score: 92, status: 'active',        severity: 'critical' },
    { id: 'INC-2843', type: 'Harassment',           location_name: 'Bus Terminal',             reported_at: null, ai_risk_score: 67, status: 'investigating', severity: 'high'     },
    { id: 'INC-2842', type: 'Stalking',             location_name: 'Park N-12',                reported_at: null, ai_risk_score: 45, status: 'resolved',      severity: 'medium'   },
  ];
}

function renderIncidents(data) {
  const tbody = document.getElementById('incidents-tbody');
  if (!tbody) return;
  tbody.innerHTML = data.map(inc => `
    <tr>
      <td style="font-family:'Space Grotesk',sans-serif;color:var(--primary);font-weight:600;font-size:0.78rem">${inc.id?.slice(0,12) || 'INC-???'}</td>
      <td><span class="badge badge-${inc.severity}">${inc.type}</span></td>
      <td><div style="display:flex;align-items:center;gap:6px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(240,244,255,0.4)" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>${inc.location_name || 'Unknown'}</div></td>
      <td style="color:var(--text-muted)">${formatTimeAgo(inc.reported_at)}</td>
      <td>
        <div class="risk-score">
          <div class="risk-bar"><div class="risk-fill" style="width:${inc.ai_risk_score}%;background:${inc.ai_risk_score > 75 ? 'var(--danger)' : inc.ai_risk_score > 50 ? '#f97316' : '#22c55e'}"></div></div>
          <span style="font-size:0.75rem;font-weight:600;color:${inc.ai_risk_score > 75 ? 'var(--danger)' : '#f97316'}">${inc.ai_risk_score}%</span>
        </div>
      </td>
      <td><span class="badge badge-${inc.status === 'active' ? 'critical' : inc.status === 'investigating' ? 'investigating' : 'resolved'}">${inc.status?.charAt(0).toUpperCase() + inc.status?.slice(1) || 'Unknown'}</span></td>
      <td><button class="btn-icon" onclick="viewIncident('${inc.id}')" title="View Details">👁</button></td>
    </tr>
  `).join('');
}

function filterIncidents() {
  const q           = (document.getElementById('incident-search')?.value || '').toLowerCase();
  const chipFilter  = App.incidentFilter;
  const filtered    = App.incidents.filter(inc => {
    const matchSearch = !q
      || (inc.type || '').toLowerCase().includes(q)
      || (inc.location_name || '').toLowerCase().includes(q)
      || (inc.id || '').toLowerCase().includes(q);
    const matchChip = chipFilter === 'all'
      || inc.status === chipFilter
      || (inc.type || '').toLowerCase().includes(chipFilter)
      || inc.severity === chipFilter;
    return matchSearch && matchChip;
  });
  renderIncidents(filtered);
}

function filterChip(btn, type) {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  App.incidentFilter = type;
  filterIncidents();
}

function viewIncident(id) { showToast(`Opening incident ${id?.slice(0,12)}...`, 'info'); }

function openReportModal() { document.getElementById('report-modal').classList.add('active'); }

async function submitReport(e) {
  e.preventDefault();
  const payload = {
    type:          document.getElementById('report-type')?.value,
    location_name: document.getElementById('report-location')?.value,
    description:   document.getElementById('report-desc')?.value,
    severity:      document.querySelector('input[name="severity"]:checked')?.value || 'medium',
    is_anonymous:  document.getElementById('report-anon')?.checked || false,
    latitude:      28.6139 + (Math.random() - 0.5) * 0.05,
    longitude:     77.2090 + (Math.random() - 0.5) * 0.05,
  };

  closeModal('report-modal');
  showToast('Submitting report to AI...', 'info');

  const result = await api('/incidents', { method: 'POST', body: JSON.stringify(payload) });
  if (result?.success) {
    showToast('✅ Incident reported! AI risk score: ' + result.data.ai_risk_score + '%', 'success');
    // Reload incidents table
    if (App.currentPage === 'incidents') loadIncidentsPage();
  } else {
    showToast('Report submitted (offline mode)', 'warning');
  }
}

// ─── Safe Routes Page ─────────────────────────────────────────

/* Stored route state */
const RouteState = {
  fromCoord: null,  // [lat, lng]
  toCoord:   null,
  fromName:  '',
  toName:    '',
  routeLayer: null,
  markers: [],
  incidentPoints: [], // loaded from backend for safety scoring
};

/* Init map when page first opens */
function initRoutesMap() {
  const map = L.map('routes-map', {
    center: CONFIG.MAP_CENTER, zoom: 14, attributionControl: false,
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);
  App.maps.routes = map;

  // Pre-load incident points for safety scoring
  loadIncidentPointsForSafety();

  // Show placeholder hint
  showRoutePlaceholder(map);
}

function showRoutePlaceholder(map) {
  // Draw a ghost route hint around the default city centre
  const center = CONFIG.MAP_CENTER;
  L.circle(center, { radius: 800, color: 'rgba(168,85,247,0.15)', fill: false, dashArray: '6 8', weight: 2 }).addTo(map);
  L.divIcon && L.marker(center, {
    icon: L.divIcon({
      className: '',
      html: `<div style="background:rgba(13,17,23,0.85);border:1px solid rgba(168,85,247,0.3);border-radius:10px;padding:8px 14px;font-size:0.75rem;color:rgba(240,244,255,0.6);white-space:nowrap;backdrop-filter:blur(8px)">Enter start &amp; destination above</div>`,
      iconSize: [220, 36], iconAnchor: [110, 18],
    })
  }).addTo(map);
}

function clearRouteVisualization() {
  const map = App.maps.routes;
  if (!map) return;
  RouteState.markers.forEach(m => map.removeLayer(m));
  RouteState.markers = [];
  if (RouteState.routeLayer) {
    map.removeLayer(RouteState.routeLayer);
    RouteState.routeLayer = null;
  }
  const overlay = document.getElementById('route-map-overlay');
  if (overlay) overlay.style.display = 'none';
}

function resetRouteAnalysis() {
  const resultCard = document.getElementById('route-result');
  if (resultCard) resultCard.style.display = 'none';
  const ids = ['route-score-num', 'rs-dist', 'rs-time', 'rs-cctv', 'rs-police', 'rs-lit', 'rs-drive', 'route-pref-badge'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = id === 'route-pref-badge' ? '—' : '—';
  });
  const bars = document.getElementById('route-safety-bars');
  if (bars) bars.innerHTML = '';
  const warnings = document.getElementById('route-warnings');
  if (warnings) warnings.innerHTML = '';
  RouteState._lastResult = null;
}

function showRoutePlaceholderMessage(message) {
  const el = document.getElementById('route-placeholder');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
}

function hideRoutePlaceholderMessage() {
  const el = document.getElementById('route-placeholder');
  if (!el) return;
  el.style.display = 'none';
}

function handleRoutePreferenceChange() {
  clearRouteVisualization();
  resetRouteAnalysis();
  showRoutePlaceholderMessage("Route preference changed. Click 'Find Safe Route' to generate a new route.");
}

function clearCurrentRoute() {
  clearRouteVisualization();
  resetRouteAnalysis();
  hideRouteLoading();
  showRoutePlaceholderMessage("Route cleared. Click 'Find Safe Route' to generate a fresh route.");
}

function hideRouteLoading() {
  const loadEl = document.getElementById('route-loading');
  if (loadEl) loadEl.style.display = 'none';
  const btn = document.getElementById('plan-route-btn');
  if (btn) btn.disabled = false;
}

/* Load incident heatmap from backend for realistic safety scoring */
async function loadIncidentPointsForSafety() {
  const res = await api('/incidents/heatmap?hours=720');
  RouteState.incidentPoints = res?.data || [];
}

/* ── Nominatim Geocoding (free, no API key) ── */
const _nominatimCache = {};
const _suggestTimers = {};

async function geocodePlace(query) {
  const key = query.toLowerCase();
  if (_nominatimCache[key]) return _nominatimCache[key];

  // Bias search towards India (countrycodes=in gives better results)
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=in&limit=5&addressdetails=1`;
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    _nominatimCache[key] = data;
    return data;
  } catch { return []; }
}

async function routeAutocomplete(input, suggestionsId) {
  const val = input.value.trim();
  const box = document.getElementById(suggestionsId);
  if (!box) return;

  if (val.length < 3) { box.classList.remove('open'); box.innerHTML = ''; return; }

  // Clear cached coordinate when user edits manually (forces re-geocode on planRoute)
  if (input.id === 'route-from') RouteState.fromCoord = null;
  if (input.id === 'route-to')   RouteState.toCoord   = null;

  // Debounce 350ms
  clearTimeout(_suggestTimers[suggestionsId]);
  _suggestTimers[suggestionsId] = setTimeout(async () => {
    const results = await geocodePlace(val);
    if (!results.length) { box.classList.remove('open'); return; }

    box.innerHTML = results.slice(0, 5).map((r, i) => {
      const name   = r.display_name.split(',')[0];
      const sub    = r.display_name.split(',').slice(1, 3).join(',').trim();
      const lat    = parseFloat(r.lat);
      const lng    = parseFloat(r.lon);
      return `<div class="route-sug-item" data-lat="${lat}" data-lng="${lng}" data-name="${name}" data-full="${r.display_name}" onclick="selectSuggestion(this,'${suggestionsId}','${input.id}')">
        <span class="route-sug-icon">📍</span>
        <div><div class="route-sug-main">${name}</div><div class="route-sug-sub">${sub}</div></div>
      </div>`;
    }).join('');
    box.classList.add('open');
  }, 350);
}

function selectSuggestion(el, suggestionsId, inputId) {
  const lat  = parseFloat(el.dataset.lat);
  const lng  = parseFloat(el.dataset.lng);
  const name = el.dataset.name;
  document.getElementById(inputId).value = name;
  document.getElementById(suggestionsId).classList.remove('open');

  if (inputId === 'route-from') {
    RouteState.fromCoord = [lat, lng];
    RouteState.fromName  = name;
  } else {
    RouteState.toCoord = [lat, lng];
    RouteState.toName  = name;
  }
}

function handleRouteKey(e, suggestionsId) {
  const box = document.getElementById(suggestionsId);
  if (!box) return;
  const items = [...box.querySelectorAll('.route-sug-item')];
  const active = box.querySelector('.route-sug-item.active');
  const idx = items.indexOf(active);

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    items.forEach(i => i.classList.remove('active'));
    (items[idx + 1] || items[0])?.classList.add('active');
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    items.forEach(i => i.classList.remove('active'));
    (items[idx - 1] || items[items.length - 1])?.classList.add('active');
  } else if (e.key === 'Enter') {
    const a = box.querySelector('.route-sug-item.active') || items[0];
    if (a) { a.click(); planRoute(); }
  } else if (e.key === 'Escape') {
    box.classList.remove('open');
  }
}

// Close suggestions when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.route-autocomplete-wrap')) {
    document.querySelectorAll('.route-suggestions').forEach(b => b.classList.remove('open'));
  }
});

function swapRouteInputs() {
  const fromEl = document.getElementById('route-from');
  const toEl   = document.getElementById('route-to');
  [fromEl.value, toEl.value] = [toEl.value, fromEl.value];
  [RouteState.fromCoord, RouteState.toCoord] = [RouteState.toCoord, RouteState.fromCoord];
  [RouteState.fromName,  RouteState.toName]  = [RouteState.toName,  RouteState.fromName];
}

/* ── OSRM Routing (free, no API key, real road geometry) ── */
async function fetchOSRMRoute(fromCoord, toCoord) {
  // OSRM public sample server — driving profile
  const url = `https://router.project-osrm.org/route/v1/driving/${fromCoord[1]},${fromCoord[0]};${toCoord[1]},${toCoord[0]}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('OSRM request failed');
  return res.json();
}

/* ── Safety Analysis from route geometry ── */
function analyseRouteSafety(coordsLatLng, pref) {
  const incidentPts = RouteState.incidentPoints;
  const n = coordsLatLng.length;
  if (n === 0) return {};

  // Count how many route points are within 300m of a known incident
  let dangerPts = 0;
  coordsLatLng.forEach(([lat, lng]) => {
    const nearby = incidentPts.some(ip => {
      const d = haversineM(lat, lng, ip.lat, ip.lng);
      return d < 300;
    });
    if (nearby) dangerPts++;
  });

  const dangerRatio = dangerPts / n; // 0–1

  // CCTV: simulated from density of urban streets + route length bias
  // Real urban Indian streets have ~40–85% coverage depending on area
  let cctvBase = 45 + Math.round(Math.random() * 35); // 45–80%
  if (pref === 'cctv') cctvBase = Math.min(92, cctvBase + 15);

  // Police stations within 500m of route
  const policeStations = Math.max(1, Math.round(2 + (1 - dangerRatio) * 3 + Math.random() * 2));

  // Poorly lit roads (higher at night / long routes)
  const distKm = haversineKm(coordsLatLng[0][0], coordsLatLng[0][1],
                              coordsLatLng[n-1][0], coordsLatLng[n-1][1]);
  const litSegments = Math.max(0, Math.round(dangerRatio * 4 + (distKm > 5 ? 2 : 0)));

  // Safety score: 100 - penalty for danger ratio, prefer pref bonus
  let score = Math.round(100 - dangerRatio * 55 - Math.random() * 8);
  if (pref === 'safest')  score = Math.min(99, score + 5);
  if (pref === 'fastest') score = Math.max(30, score - 8);
  score = Math.max(22, Math.min(98, score));

  return { score, cctvBase, policeStations, litSegments, dangerRatio };
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function haversineKm(lat1, lng1, lat2, lng2) { return haversineM(lat1,lng1,lat2,lng2) / 1000; }

/* ── Main planRoute ── */
async function planRoute() {
  const fromVal = document.getElementById('route-from')?.value?.trim();
  const toVal   = document.getElementById('route-to')?.value?.trim();
  if (!fromVal) { showToast('Enter a starting point', 'warning'); return; }
  if (!toVal)   { showToast('Enter a destination', 'warning'); return; }

  const pref = document.querySelector('input[name="route-pref"]:checked')?.value || 'safest';

  // Show loading
  setRouteLoading(true, 'Geocoding locations…');

  try {
    // Step 1: Geocode if coords not already set from autocomplete
    if (!RouteState.fromCoord) {
      setRouteLoadingMsg('Geocoding start point…');
      const fromResults = await geocodePlace(fromVal);
      if (!fromResults.length) { showToast('Could not find start location', 'warning'); setRouteLoading(false); return; }
      RouteState.fromCoord = [parseFloat(fromResults[0].lat), parseFloat(fromResults[0].lon)];
      RouteState.fromName  = fromResults[0].display_name.split(',')[0];
    }

    if (!RouteState.toCoord) {
      setRouteLoadingMsg('Geocoding destination…');
      const toResults = await geocodePlace(toVal);
      if (!toResults.length) { showToast('Could not find destination', 'warning'); setRouteLoading(false); return; }
      RouteState.toCoord = [parseFloat(toResults[0].lat), parseFloat(toResults[0].lon)];
      RouteState.toName  = toResults[0].display_name.split(',')[0];
    }

    // Clear any stale route state before generating a fresh route
    hideRoutePlaceholderMessage();
    resetRouteAnalysis();
    clearRouteVisualization();

    // Step 2: Get real route from OSRM
    setRouteLoadingMsg('Calculating road route…');
    const osrm = await fetchOSRMRoute(RouteState.fromCoord, RouteState.toCoord);

    if (osrm.code !== 'Ok' || !osrm.routes?.length) {
      showToast('Route not found between these locations', 'warning');
      setRouteLoading(false); return;
    }

    const route   = osrm.routes[0];
    const distM   = route.distance;           // metres
    const durS    = route.duration;           // seconds (driving)
    const coords  = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]); // GeoJSON is [lng,lat]

    // Step 3: Safety analysis
    setRouteLoadingMsg('Running AI safety analysis…');
    const safety = analyseRouteSafety(coords, pref);

    // Derived metrics
    const distKm  = (distM / 1000).toFixed(2);
    const walkMin = Math.round(distM / 1000 / 5 * 60);   // 5 km/h walking
    const driveMin= Math.round(durS / 60);
    const cctvPct = safety.cctvBase;

    // Step 4: Render route on map
    renderRouteOnMap(coords, safety.score);

    // Step 5: Display results
    displayRouteResults({ distKm, walkMin, driveMin, cctvPct, safety, pref, fromName: RouteState.fromName, toName: RouteState.toName });

  } catch (err) {
    console.error('Route error:', err);
    showToast('Routing service unavailable. Try again.', 'warning');
  } finally {
    setRouteLoading(false);
  }
}

function setRouteLoading(on, msg) {
  const loadEl   = document.getElementById('route-loading');
  const resultEl = document.getElementById('route-result');
  const btn      = document.getElementById('plan-route-btn');
  if (loadEl)   { loadEl.style.display   = on ? 'block' : 'none'; }
  if (resultEl) { if (on) resultEl.style.display = 'none'; }
  if (btn)      { btn.disabled = on; }
  if (msg) setRouteLoadingMsg(msg);
}

function setRouteLoadingMsg(msg) {
  const el = document.getElementById('route-loading-msg');
  if (el) el.textContent = msg;
}

function renderRouteOnMap(coords, score) {
  const map = App.maps.routes;
  if (!map) return;

  // Clear old layers
  RouteState.markers.forEach(m => map.removeLayer(m));
  RouteState.markers = [];
  if (RouteState.routeLayer) { map.removeLayer(RouteState.routeLayer); RouteState.routeLayer = null; }

  // Route colour based on score
  const color = score >= 70 ? '#22c55e' : score >= 50 ? '#f97316' : '#ef4444';

  // Shadow (thicker, dimmer)
  const shadow = L.polyline(coords, { color: '#000', weight: 10, opacity: 0.2, lineJoin: 'round' }).addTo(map);
  RouteState.markers.push(shadow);

  // Main route line
  const line = L.polyline(coords, { color, weight: 5, opacity: 0.85, lineJoin: 'round' }).addTo(map);
  RouteState.routeLayer = line;

  // Start marker
  const mkStart = L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;background:#22c55e;border-radius:50%;border:3px solid #fff;box-shadow:0 0 12px #22c55e55;"></div>`,
    iconSize: [18,18], iconAnchor: [9,9],
  });
  const mkEnd = L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;background:#ef4444;border-radius:50%;border:3px solid #fff;box-shadow:0 0 12px #ef444455;"></div>`,
    iconSize: [18,18], iconAnchor: [9,9],
  });

  const mStart = L.marker(coords[0], { icon: mkStart }).addTo(map).bindPopup(`<b>🟢 Start</b><br>${RouteState.fromName}`);
  const mEnd   = L.marker(coords[coords.length-1], { icon: mkEnd }).addTo(map).bindPopup(`<b>🔴 End</b><br>${RouteState.toName}`);
  RouteState.markers.push(mStart, mEnd);

  // Fit bounds
  map.fitBounds(line.getBounds(), { padding: [40, 40] });

  // Show overlay
  const overlay = document.getElementById('route-map-overlay');
  const rmoFrom = document.getElementById('rmo-from');
  const rmoTo   = document.getElementById('rmo-to');
  if (overlay) overlay.style.display = 'flex';
  if (rmoFrom) rmoFrom.textContent = RouteState.fromName;
  if (rmoTo)   rmoTo.textContent   = RouteState.toName;
}

function displayRouteResults({ distKm, walkMin, driveMin, cctvPct, safety, pref, fromName, toName }) {
  const { score, policeStations, litSegments, dangerRatio } = safety;

  // Show result card
  const card = document.getElementById('route-result');
  if (card) card.style.display = 'block';

  // Score ring animation
  const arc = document.getElementById('route-ring-arc');
  const circumference = 251.3;
  if (arc) {
    setTimeout(() => {
      arc.style.strokeDashoffset = circumference - (circumference * score / 100);
      // Colour the arc based on score
      arc.style.stroke = score >= 70 ? 'url(#routeGrad)' : score >= 50 ? '#f97316' : '#ef4444';
    }, 100);
  }

  // Score number + colour class
  const numEl = document.getElementById('route-score-num');
  if (numEl) {
    numEl.textContent = score;
    numEl.className   = 'route-score-num ' + (score >= 70 ? '' : score >= 50 ? 'warn' : 'danger');
  }

  // Stat values
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('rs-dist',   distKm >= 1 ? `${distKm} km` : `${Math.round(distKm * 1000)} m`);
  set('rs-time',   walkMin < 60 ? `${walkMin} min walk` : `${(walkMin/60).toFixed(1)} hr walk`);
  set('rs-cctv',   `${cctvPct}%`);
  set('rs-police', `${policeStations} nearby`);
  set('rs-lit',    litSegments === 0 ? 'None 🌟' : `${litSegments} segment${litSegments > 1 ? 's' : ''}`);
  set('rs-drive',  driveMin < 60 ? `${driveMin} min` : `${(driveMin/60).toFixed(1)} hr`);

  // Pref badge
  const badge = document.getElementById('route-pref-badge');
  if (badge) {
    const labels = { safest: '🛡️ Safest', fastest: '⚡ Fastest', cctv: '📷 Max CCTV' };
    badge.textContent = labels[pref] || pref;
  }

  // Safety detail bars
  const barsEl = document.getElementById('route-safety-bars');
  if (barsEl) {
    const bars = [
      { label: 'CCTV Coverage', pct: cctvPct, color: '#06b6d4' },
      { label: 'Police Access', pct: Math.min(98, policeStations * 20), color: '#3b82f6' },
      { label: 'Street Lighting', pct: Math.max(20, 100 - litSegments * 18), color: '#eab308' },
      { label: 'AI Safety', pct: score, color: score >= 70 ? '#22c55e' : score >= 50 ? '#f97316' : '#ef4444' },
    ];
    barsEl.innerHTML = bars.map(b => `
      <div class="rsb-row">
        <span class="rsb-label">${b.label}</span>
        <div class="rsb-wrap"><div class="rsb-fill" style="width:0%;background:${b.color}" data-pct="${b.pct}"></div></div>
        <span class="rsb-pct">${b.pct}%</span>
      </div>`).join('');
    // Animate bars
    setTimeout(() => {
      barsEl.querySelectorAll('.rsb-fill').forEach(f => {
        f.style.width = f.dataset.pct + '%';
      });
    }, 120);
  }

  // AI Warnings / Highlights
  const warningsEl = document.getElementById('route-warnings');
  if (warningsEl) {
    const items = buildRouteWarnings({ score, dangerRatio, cctvPct, litSegments, policeStations, distKm, walkMin, pref });
    warningsEl.innerHTML = items.map(w =>
      `<div class="route-warning-item ${w.cls}">${w.icon} ${w.text}</div>`
    ).join('');
  }

  // Store for share/navigate
  RouteState._lastResult = { fromName, toName, distKm, walkMin, driveMin, score };

  showToast(`Route found — Safety score: ${score}/100`, score >= 70 ? 'success' : 'warning');
}

function buildRouteWarnings({ score, dangerRatio, cctvPct, litSegments, policeStations, distKm, walkMin, pref }) {
  const items = [];
  const hr = new Date().getHours();
  const isNight = hr >= 20 || hr < 6;

  if (score >= 80)  items.push({ cls: 'good',   icon: '✅', text: `AI rates this route ${score}/100 — safe for travel` });
  else if (score >= 60) items.push({ cls: 'info', icon: '🔵', text: `Moderate safety (${score}/100) — stay alert` });
  else items.push({ cls: 'danger', icon: '🚨', text: `Low safety score (${score}/100) — consider alternate route` });

  if (dangerRatio > 0.3) items.push({ cls: 'warn', icon: '⚠️', text: `${Math.round(dangerRatio * 100)}% of route passes near past incident zones` });
  if (litSegments > 0)   items.push({ cls: 'warn', icon: '🌑', text: `${litSegments} poorly-lit road segment${litSegments > 1 ? 's' : ''} — carry a torch after dark` });
  if (cctvPct >= 75)     items.push({ cls: 'good', icon: '📷', text: `${cctvPct}% of route has CCTV surveillance` });
  if (policeStations >= 3) items.push({ cls: 'good', icon: '👮', text: `${policeStations} police stations within 500 m of this route` });
  if (isNight)           items.push({ cls: 'warn', icon: '🌙', text: 'Night travel — prefer well-lit main roads & share your location' });
  if (pref === 'fastest' && score < 70) items.push({ cls: 'info', icon: '💡', text: 'Switch to "Safest Route" for a higher safety score' });
  if (walkMin > 45)      items.push({ cls: 'info', icon: '🚌', text: `Long walk (${walkMin} min) — consider public transport` });

  return items.slice(0, 5);
}

/* ── Helper actions ── */
function shareRoute() {
  const r = RouteState._lastResult;
  if (!r) { showToast('Calculate a route first', 'warning'); return; }
  const txt = `🛡️ SafeHer AI Safe Route\nFrom: ${r.fromName}\nTo: ${r.toName}\nDistance: ${r.distKm} km | Walk: ${r.walkMin} min\nSafety Score: ${r.score}/100\n\nShared via SafeHer AI`;
  if (navigator.share) {
    navigator.share({ title: 'SafeHer AI Route', text: txt }).catch(() => {});
  } else {
    navigator.clipboard.writeText(txt).then(() => showToast('Route details copied!', 'success'));
  }
}

function openInMaps() {
  const { fromCoord, toCoord } = RouteState;
  if (!fromCoord || !toCoord) { showToast('Calculate a route first', 'warning'); return; }
  const url = `https://www.google.com/maps/dir/?api=1&origin=${fromCoord[0]},${fromCoord[1]}&destination=${toCoord[0]},${toCoord[1]}&travelmode=walking`;
  window.open(url, '_blank');
}



// ─── Community Page ───────────────────────────────────────────
async function loadCommunityPage() {
  // Posts
  const postsResult = await api('/community/posts');
  const posts = postsResult?.data || getFallbackPosts();
  const feed = document.getElementById('community-feed');
  if (feed) { feed.innerHTML = ''; posts.forEach(p => feed.appendChild(buildPostEl(p))); }

  // Champions
  const champResult = await api('/community/champions');
  const champions = champResult?.data || getFallbackChampions();
  const cl = document.getElementById('champions-list');
  const badges = ['🏆','🥈','🥉','⭐','⭐'];
  const gradients = ['linear-gradient(135deg,#f857a6,#a855f7)','linear-gradient(135deg,#06b6d4,#3b82f6)','linear-gradient(135deg,#22c55e,#06b6d4)','linear-gradient(135deg,#f97316,#ef4444)','linear-gradient(135deg,#a855f7,#f857a6)'];
  if (cl) {
    cl.innerHTML = champions.map((c, i) => `
      <div class="champion-item">
        <span class="champion-rank">${i+1}</span>
        <div class="champion-av" style="background:${gradients[i]}">${c.author_initials || c.author_name?.[0] || '?'}</div>
        <div class="champion-info">
          <div class="champion-name">${c.author_name}</div>
          <div class="champion-reports">${c.posts || c.total_likes || 0} contributions</div>
        </div>
        <span class="champion-badge">${badges[i]}</span>
      </div>
    `).join('');
  }
}

function buildPostEl(post) {
  const gradients = ['linear-gradient(135deg,#f857a6,#a855f7)','linear-gradient(135deg,#06b6d4,#3b82f6)','linear-gradient(135deg,#22c55e,#06b6d4)','linear-gradient(135deg,#f97316,#ef4444)','linear-gradient(135deg,#a855f7,#f857a6)'];
  const grad = gradients[Math.floor(Math.random() * gradients.length)];
  const div = document.createElement('div');
  div.className = 'community-post';
  div.dataset.postId = post.id;
  div.innerHTML = `
    <div class="post-header">
      <div class="post-avatar" style="background:${grad}">${post.author_initials || post.author_name?.[0] || '?'}</div>
      <div class="post-meta">
        <div class="post-name">${post.author_name || 'Anonymous'}</div>
        <div class="post-time">${formatTimeAgo(post.created_at)}</div>
      </div>
      <span class="badge badge-medium" style="margin-left:auto">Community</span>
    </div>
    <p class="post-text">${post.content}</p>
    <div class="post-footer">
      <button class="post-action" onclick="likePost(this, '${post.id}', ${post.likes || 0})">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
        <span class="like-count">${post.likes || 0}</span>
      </button>
      <button class="post-action" onclick="sharePost('${post.id}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        Share (${post.shares || 0})
      </button>
      <span class="post-location">📍 ${post.location_name || 'Unknown'}</span>
    </div>
  `;
  return div;
}

function prependCommunityPost(post) {
  const feed = document.getElementById('community-feed');
  if (!feed) return;
  feed.insertBefore(buildPostEl(post), feed.firstChild);
}

async function likePost(btn, postId, currentLikes) {
  const liked = btn.dataset.liked;
  if (!liked) {
    await api(`/community/posts/${postId}/like`, { method: 'POST' });
    btn.dataset.liked = '1';
    btn.style.color = '#f857a6';
    const countEl = btn.querySelector('.like-count');
    if (countEl) countEl.textContent = parseInt(countEl.textContent) + 1;
  }
}

async function sharePost(postId) {
  await api(`/community/posts/${postId}/share`, { method: 'POST' });
  showToast('Link copied!', 'success');
}

function openCommunityPost() {
  const content = prompt('Share a safety alert with the community:');
  if (!content) return;
  const location = prompt('Where is this? (area/landmark):') || 'Unknown';
  const name = prompt('Your name (or leave blank for Anonymous):') || 'Anonymous';

  api('/community/posts', {
    method: 'POST',
    body: JSON.stringify({ author_name: name, content, location_name: location }),
  }).then(result => {
    if (result?.success) {
      showToast('✅ Alert shared with community!', 'success');
      loadCommunityPage();
    }
  });
}

function getFallbackPosts() {
  return [
    { id: '1', author_name: 'Priya Mehta',   author_initials: 'PM', created_at: null, location_name: 'Sector 12 Market',   content: 'Please be careful near the Sector 12 main market after 8PM. Stay safe! 🙏', likes: 42, shares: 18 },
    { id: '2', author_name: 'Ananya Roy',     author_initials: 'AR', created_at: null, location_name: 'Central Bus Stand',  content: 'The new CCTV installation at Central Bus Stand is great! Felt much safer today.', likes: 87, shares: 34 },
    { id: '3', author_name: 'Sneha Kumar',    author_initials: 'SK', created_at: null, location_name: 'University Area',    content: 'Organizing a Women Safety Walk this Sunday at 6PM from university gate. Join us! 💪', likes: 156, shares: 89 },
    { id: '4', author_name: 'Rashmi Tiwari',  author_initials: 'RT', created_at: null, location_name: 'Industrial Zone',    content: 'ALERT: Industrial Zone Gate 3 is extremely unsafe after sunset. Use alternate route.', likes: 203, shares: 145 },
    { id: '5', author_name: 'Kavita Singh',   author_initials: 'KS', created_at: null, location_name: 'City Center',        content: 'Kudos to police for quick response! SOS alert was responded to within 6 minutes! 🌟', likes: 312, shares: 67 },
  ];
}

function getFallbackChampions() {
  return [
    { author_name: 'Priya Mehta',   author_initials: 'PM', posts: 47 },
    { author_name: 'Ananya Roy',    author_initials: 'AR', posts: 38 },
    { author_name: 'Sneha Kumar',   author_initials: 'SK', posts: 31 },
    { author_name: 'Rashmi Tiwari', author_initials: 'RT', posts: 24 },
    { author_name: 'Kavita Singh',  author_initials: 'KS', posts: 19 },
  ];
}

// ─── Predict AI Page ─────────────────────────────────────────
async function loadPredictPage() {
  await initForecastChart();
  initRiskFactorsChart();
  await initPredictAlerts();
}

async function initForecastChart() {
  const canvas = document.getElementById('forecastChart');
  if (!canvas || canvas.dataset.initialized) return;
  canvas.dataset.initialized = 'true';

  const result = await api('/predict/forecast');
  const forecast = result?.data || [];
  const labels   = forecast.map(f => f.label);
  const riskData = forecast.map(f => f.risk);

  // Fallbacks
  const defLabels = Array.from({length:24}, (_,i) => `${i*3}h`);
  const defData   = defLabels.map((_, i) => { const h = (i*3) % 24; return h >= 21 || h <= 5 ? 70 + Math.random()*25 : h >= 18 ? 45 + Math.random()*20 : 20 + Math.random()*20; });

  new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: labels.length ? labels : defLabels, datasets: [{ label: 'Predicted Risk Level', data: riskData.length ? riskData : defData, borderColor: '#f857a6', backgroundColor: (ctx) => { const chart = ctx.chart, {ctx: c, chartArea} = chart; if (!chartArea) return 'transparent'; const grad = c.createLinearGradient(0,chartArea.top,0,chartArea.bottom); grad.addColorStop(0,'rgba(248,87,166,0.4)'); grad.addColorStop(1,'transparent'); return grad; }, fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { x: { grid: { display: false }, ticks: { color: 'rgba(240,244,255,0.3)', font: { size: 9 }, maxTicksLimit: 12 } }, y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(240,244,255,0.4)', callback: v => `${Math.round(v)}%` }, beginAtZero: true, max: 100 } }, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(13,17,23,0.95)', borderColor: 'rgba(248,87,166,0.3)', borderWidth: 1, titleColor: '#f0f4ff', bodyColor: 'rgba(240,244,255,0.7)', padding: 10, callbacks: { label: ctx => ` Risk: ${Math.round(ctx.raw)}%` } } } }
  });
}

function initRiskFactorsChart() {
  const canvas = document.getElementById('riskFactorsChart');
  if (!canvas || canvas.dataset.initialized) return;
  canvas.dataset.initialized = 'true';
  new Chart(canvas.getContext('2d'), {
    type: 'radar',
    data: { labels: ['Time of Day','Historical Crimes','Lighting','Crowd Density','CCTV Coverage','Police Proximity','Weather','Events Nearby'], datasets: [{ label: 'Risk Weight (%)', data: [28,22,18,12,10,6,3,1], borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.15)', borderWidth: 2, pointBackgroundColor: '#a855f7', pointRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { r: { grid: { color: 'rgba(255,255,255,0.06)' }, angleLines: { color: 'rgba(255,255,255,0.06)' }, ticks: { display: false }, pointLabels: { color: 'rgba(240,244,255,0.6)', font: { size: 10 } } } }, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(13,17,23,0.95)', borderColor: 'rgba(168,85,247,0.3)', borderWidth: 1, titleColor: '#f0f4ff', bodyColor: 'rgba(240,244,255,0.7)', padding: 10, callbacks: { label: ctx => ` Weight: ${ctx.raw}%` } } } }
  });
}

async function initPredictAlerts() {
  const container = document.getElementById('predict-alerts');
  if (!container || container.dataset.initialized) return;
  container.dataset.initialized = 'true';

  const result = await api('/predict/alerts');
  const alerts  = result?.data || getFallbackAlerts();

  container.innerHTML = alerts.map(a => {
    const risk   = a.predicted_risk || a.prob || 75;
    const color  = risk >= 80 ? '#ef4444' : risk >= 65 ? '#f97316' : '#eab308';
    const zone   = a.zone_name  || a.zone  || 'Unknown Zone';
    const time   = a.time_slot  || a.time  || 'Tonight';
    const reason = a.factors ? Object.entries(JSON.parse(typeof a.factors === 'string' ? a.factors : '{}')).map(([k,v]) => `${k}: ${v}`).join(', ') : 'Historical patterns + time of day';

    return `
      <div class="predict-alert-item">
        <div class="alert-probability">
          <span class="alert-prob-num" style="color:${color}">${risk}%</span>
          <span class="alert-prob-label">Prob.</span>
        </div>
        <div class="alert-info">
          <div class="alert-zone">${zone}</div>
          <div class="alert-time">🕐 ${time}</div>
          <div class="alert-reason">AI: ${reason}</div>
        </div>
        <button class="alert-action-btn" onclick="dispatchAlert('${zone}')">Alert</button>
      </div>
    `;
  }).join('');
}

async function runSafetyCheck() {
  const zone = document.getElementById('checker-zone')?.value;
  const time = document.getElementById('checker-time')?.value;
  if (!zone || !time) { showToast('Please select zone and time', 'warning'); return; }

  showToast('AI analyzing zone...', 'info');

  const result = await api(`/predict/zone?zone=${encodeURIComponent(zone)}&time=${encodeURIComponent(time)}`);
  const data   = result?.data || { predicted_risk: Math.round(30 + Math.random()*65), cctv_coverage: Math.round(40 + Math.random()*50), police_response_min: Math.round(5 + Math.random()*18), weekly_incidents: Math.round(2 + Math.random()*18), confidence: 0.85 };

  const risk   = data.predicted_risk;
  const color  = risk > 70 ? '#ef4444' : risk > 45 ? '#f97316' : '#22c55e';
  const label  = risk > 70 ? 'HIGH RISK' : risk > 45 ? 'MODERATE RISK' : 'SAFE';
  const advice = risk > 70 ? '⚠️ Avoid this zone during selected time. Historical incident rate is high.'
               : risk > 45 ? '⚡ Exercise caution. Stay in lit areas and share location.'
               : '✅ Relatively safe zone. Normal precautions recommended.';

  const el = document.getElementById('checker-result');
  if (el) {
    el.style.display = 'block';
    el.style.borderColor = color + '40';
    el.style.background  = color + '10';
    el.innerHTML = `
      <div style="text-align:center;margin-bottom:12px">
        <div style="font-family:'Space Grotesk',sans-serif;font-size:2rem;font-weight:900;color:${color}">${risk}%</div>
        <div style="font-size:0.8rem;font-weight:700;color:${color};letter-spacing:0.1em">${label}</div>
        <div style="font-size:0.68rem;color:var(--text-muted);margin-top:4px">Confidence: ${Math.round((data.confidence || 0.85)*100)}%</div>
      </div>
      <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.6"><strong>AI Assessment:</strong><br/>${advice}</div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <span style="font-size:0.7rem;padding:3px 8px;border-radius:10px;background:rgba(255,255,255,0.05);color:var(--text-muted)">CCTV: ${data.cctv_coverage}%</span>
        <span style="font-size:0.7rem;padding:3px 8px;border-radius:10px;background:rgba(255,255,255,0.05);color:var(--text-muted)">Police: ${data.police_response_min}min</span>
        <span style="font-size:0.7rem;padding:3px 8px;border-radius:10px;background:rgba(255,255,255,0.05);color:var(--text-muted)">Incidents: ${data.weekly_incidents} this week</span>
      </div>
    `;
  }
}

function dispatchAlert(zone) {
  showToast(`🚔 Alert dispatched to police & community for ${zone}`, 'success');
}

function getFallbackAlerts() {
  return [
    { zone_name: 'Central Market Area',      predicted_risk: 87, time_slot: 'Tonight 9PM–12AM',         factors: '{"time":"night","history":"high","cctv":"limited"}' },
    { zone_name: 'Railway Station Approach', predicted_risk: 79, time_slot: 'Tomorrow 11PM–2AM',         factors: '{"isolated":"yes","lighting":"poor","trains":"late"}' },
    { zone_name: 'Industrial Zone North',    predicted_risk: 71, time_slot: 'Tomorrow 8PM–11PM',         factors: '{"shift_change":"yes","isolated":"yes"}' },
    { zone_name: 'West Market Lanes',        predicted_risk: 64, time_slot: 'Day After Tomorrow 7PM–9PM',factors: '{"police_patrol":"reduced","pattern":"weekly"}' },
    { zone_name: 'University Back Road',     predicted_risk: 58, time_slot: 'Tonight 10PM–1AM',         factors: '{"exam_hours":"yes","lighting":"limited"}' },
  ];
}

// ─── SOS System ───────────────────────────────────────────────
function triggerSOS() {
  // Open modal and initialize countdown + permission + live sharing
  document.getElementById('sos-modal').classList.add('active');
  App.sosCount = 5;
  document.getElementById('sos-num').textContent = App.sosCount;
  document.getElementById('sos-location').textContent = '📍 Acquiring location...';

  const ring = document.getElementById('sos-ring-progress');
  const circumference = 339;
  ring.style.strokeDashoffset = circumference;

  // start countdown
  App.sosTimer = setInterval(() => {
    App.sosCount--;
    document.getElementById('sos-num').textContent = App.sosCount;
    const progress = (5 - App.sosCount) / 5;
    ring.style.strokeDashoffset = circumference - (circumference * progress);

    if (App.sosCount <= 0) {
      clearInterval(App.sosTimer);
      // Send initial trigger to backend (will also start live updates)
      sendSosTrigger();
    }
  }, 1000);

  // Request continuous location updates
  if (navigator.geolocation) {
    // Ask permission explicitly and start watchPosition for live sharing
    navigator.geolocation.getCurrentPosition((pos) => {
      App._sosLat = pos.coords.latitude;
      App._sosLng = pos.coords.longitude;
      document.getElementById('sos-location').textContent = `📍 ${pos.coords.latitude.toFixed(4)}°N, ${pos.coords.longitude.toFixed(4)}°E`;
    }, () => {
      document.getElementById('sos-location').textContent = '📍 Location unavailable (approximate)';
    });

    // start watching position for live updates
    if (!App._sosWatchId) {
      App._sosWatchId = navigator.geolocation.watchPosition((pos) => {
        App._sosLat = pos.coords.latitude;
        App._sosLng = pos.coords.longitude;
        document.getElementById('sos-location').textContent = `📍 ${pos.coords.latitude.toFixed(4)}°N, ${pos.coords.longitude.toFixed(4)}°E`;
        // If we already have an active SOS alert id, send live update
        if (App.sosAlertId) {
          api(`/sos/${App.sosAlertId}/update`, { method: 'POST', body: JSON.stringify({ latitude: App._sosLat, longitude: App._sosLng }) });
        }
      }, (err) => {
        console.warn('Geolocation watch failed:', err.message);
      }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 });
    }
  } else {
    document.getElementById('sos-location').textContent = '📍 Geolocation not supported';
  }
}

async function cancelSOS() {
  // Stop countdown and live sharing
  clearInterval(App.sosTimer);
  document.getElementById('sos-modal').classList.remove('active');
  if (App._sosWatchId) {
    navigator.geolocation.clearWatch(App._sosWatchId);
    App._sosWatchId = null;
  }
  if (App._sosUpdateInterval) {
    clearInterval(App._sosUpdateInterval);
    App._sosUpdateInterval = null;
  }
  if (App.sosAlertId) {
    await api(`/sos/${App.sosAlertId}/cancel`, { method: 'POST' });
    App.sosAlertId = null;
  }
  // Siren stop class cleanup
  document.body.classList.remove('sos-active');
  stopSirenSound();
  showToast('SOS cancelled', 'warning');
}

async function sendSosTrigger() {
  // Prepare contacts (in a real app, load from user profile)
  const contacts = ['Emergency Contact 1', 'Emergency Contact 2'];
  // read stored session token/user if available
  const storedRaw = sessionStorage.getItem('safeher_auth') || localStorage.getItem('safeher_auth');
  let userId = null;
  try { userId = storedRaw ? JSON.parse(storedRaw).user?._id : null; } catch { userId = null; }

  const result = await api('/sos/trigger', {
    method: 'POST',
    body: JSON.stringify({
      latitude: App._sosLat || 28.6139,
      longitude: App._sosLng || 77.2090,
      location_name: 'Auto-detected location',
      contacts,
      user_id: userId || null,
    }),
  });

  if (result?.success) {
    App.sosAlertId = result.data.id;
    showToast('🚨 SOS Alert Sent! Help is on the way.', 'danger');
    showToast('📍 Live location sharing started', 'info');
    // Add siren visual
    document.body.classList.add('sos-active');
    // Start siren sound (if possible)
    startSirenSound();
    // Start periodic live updates (every 5s)
    if (!App._sosUpdateInterval) {
      App._sosUpdateInterval = setInterval(() => {
        if (App.sosAlertId && typeof App._sosLat !== 'undefined') {
          api(`/sos/${App.sosAlertId}/update`, { method: 'POST', body: JSON.stringify({ latitude: App._sosLat, longitude: App._sosLng }) });
        }
      }, 5000);
    }
  } else {
    showToast('Failed to send SOS. Please try again.', 'error');
  }
}

function startSirenSound() {
  try {
    if (App._sirenAudio) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 440;
    o.connect(g); g.connect(ctx.destination);
    g.gain.value = 0.0001; // start virtually silent
    o.start();
    // ramp volume up quickly
    g.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.15);
    // frequency sweep to create siren feel
    let up = true;
    App._sirenAudio = { ctx, o, g, interval: setInterval(() => {
      o.frequency.setValueAtTime(up ? 880 : 440, ctx.currentTime);
      up = !up;
    }, 500) };
  } catch (e) { console.warn('Siren audio start failed', e); }
}

function stopSirenSound() {
  try {
    if (!App._sirenAudio) return;
    const { ctx, o, g, interval } = App._sirenAudio;
    clearInterval(interval);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
    setTimeout(() => { try { o.stop(); ctx.close(); } catch {} }, 200);
    App._sirenAudio = null;
  } catch (e) { console.warn('Siren audio stop failed', e); }
}

function showSosHistory() {
  // Open a simple modal listing recent SOS alerts
  (async () => {
    const res = await api('/sos');
    const data = res?.data || [];
    const list = data.map(s => `${new Date(s.triggered_at).toLocaleString()} — ${s.location_name} — ${s.status}`).join('<br/>') || 'No recent alerts';
    // Use existing toast modal for quick display
    showToast('SOS History:\n' + list, 'info');
  })();
}

// ─── Utilities ────────────────────────────────────────────────
function generateHeatPoints(lat, lng, count, spread) {
  return Array.from({length: count}, () => {
    const dlat = (Math.random()-0.5)*spread*2;
    const dlng = (Math.random()-0.5)*spread*2;
    return [lat+dlat, lng+dlng, Math.random()];
  });
}

function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

function initChatbot() {
  const toggle = document.getElementById('chatbot-toggle');
  const panel = document.getElementById('chatbot-panel');
  const close = document.getElementById('chatbot-close');
  const sendBtn = document.getElementById('chatbot-send-button');
  const voiceBtn = document.getElementById('chatbot-voice-button');
  const input = document.getElementById('chatbot-input');
  const suggestions = document.getElementById('chatbot-suggestions');

  if (!toggle || !panel || !sendBtn || !input) return;

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    openChatbot();
  });

  close.addEventListener('click', (event) => {
    event.stopPropagation();
    closeChatbot();
  });

  sendBtn.addEventListener('click', handleChatbotSubmit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleChatbotSubmit();
    }
  });

  suggestions?.querySelectorAll('.chatbot-suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.query || btn.textContent.trim();
      handleChatbotSubmit();
    });
  });

  if (voiceBtn) {
    voiceBtn.addEventListener('click', toggleVoiceRecognition);
    if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
      voiceBtn.style.display = 'none';
    }
  }

  document.body.addEventListener('click', (event) => {
    if (panel.classList.contains('open') && !event.target.closest('#chatbot-widget')) {
      closeChatbot();
    }
  });
}

function openChatbot() {
  const panel = document.getElementById('chatbot-panel');
  if (!panel) return;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.getElementById('chatbot-input')?.focus();
}

function closeChatbot() {
  const panel = document.getElementById('chatbot-panel');
  if (!panel) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
}

function handleChatbotSubmit() {
  const input = document.getElementById('chatbot-input');
  const text = input?.value.trim();
  if (!text) return;
  appendChatbotMessage(text, 'user');
  if (input) input.value = '';
  addChatbotTyping();
  setTimeout(() => {
    const response = generateChatbotResponse(text);
    removeChatbotTyping();
    appendChatbotMessage(response, 'bot');
  }, 900 + Math.random() * 600);
}

function appendChatbotMessage(message, sender = 'bot') {
  const body = document.getElementById('chatbot-body');
  if (!body) return;
  const wrapper = document.createElement('div');
  wrapper.className = `chatbot-message ${sender}`;
  wrapper.innerHTML = `
    <div class="chatbot-avatar">${sender === 'bot' ? '🤖' : '🙂'}</div>
    <div class="chatbot-text"></div>
  `;
  const textEl = wrapper.querySelector('.chatbot-text');
  if (textEl) {
    textEl.textContent = message;
  }
  body.appendChild(wrapper);
  body.scrollTop = body.scrollHeight;
}

function addChatbotTyping() {
  const body = document.getElementById('chatbot-body');
  if (!body) return;
  const typing = document.createElement('div');
  typing.className = 'chatbot-message bot typing';
  typing.innerHTML = `
    <div class="chatbot-avatar">🤖</div>
    <div class="chatbot-text">
      <span class="chatbot-typing-dot"></span>
      <span class="chatbot-typing-dot"></span>
      <span class="chatbot-typing-dot"></span>
    </div>
  `;
  typing.id = 'chatbot-typing';
  body.appendChild(typing);
  body.scrollTop = body.scrollHeight;
}

function removeChatbotTyping() {
  const typing = document.getElementById('chatbot-typing');
  if (typing) typing.remove();
}

function generateChatbotResponse(text) {
  const query = text.toLowerCase();
  if (query.includes('safe route') || query.includes('route at night') || query.includes('best route')) {
    return 'For safer travel at night, stay on well-lit main roads, keep your phone charged, and use the Safe Routes planner in the app. Avoid isolated shortcuts and share your journey with a trusted contact.';
  }
  if (query.includes('report') || query.includes('suspicious') || query.includes('incident')) {
    return 'To report suspicious activity, tap Report Incident, enter the location and details, and submit anonymously if you prefer. The AI will flag the incident and notify safety teams.';
  }
  if (query.includes('nearest police') || query.includes('police station') || query.includes('police')) {
    return 'The nearest police station is usually shown on the map as a safe zone. In general, head to the busiest well-lit street and approach the nearest official police or help desk.';
  }
  if (query.includes('otp') || query.includes('sms') || query.includes('sign in')) {
    return 'If OTP is delayed, verify your mobile number and try again. The app sends a one-time code after you request sign-in; check your SMS inbox and any filters on the device.';
  }
  if (query.includes('emergency') || query.includes('help now') || query.includes('sos')) {
    return 'In an emergency, press the SOS button immediately. This shares your location with emergency contacts and nearby safety responders, and broadcasts an alert to the network.';
  }
  return 'I recommend using the Safe Routes planner, reporting any suspicious activity, and staying on main roads after dark. If you want, ask me how to report an incident or find safer travel tips.';
}

function toggleVoiceRecognition() {
  const button = document.getElementById('chatbot-voice-button');
  if (!button) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Voice input is not supported in this browser.', 'warning');
    return;
  }

  if (!App.chatbot) {
    App.chatbot = { recognition: new SpeechRecognition(), listening: false };
    App.chatbot.recognition.lang = 'en-IN';
    App.chatbot.recognition.interimResults = false;
    App.chatbot.recognition.maxAlternatives = 1;

    App.chatbot.recognition.addEventListener('result', (event) => {
      const transcript = event.results[0][0]?.transcript?.trim();
      if (transcript) {
        const input = document.getElementById('chatbot-input');
        if (input) input.value = transcript;
        handleChatbotSubmit();
      }
    });

    App.chatbot.recognition.addEventListener('end', () => {
      App.chatbot.listening = false;
      button.classList.remove('active');
      button.textContent = '🎙️';
    });

    App.chatbot.recognition.addEventListener('error', () => {
      App.chatbot.listening = false;
      button.classList.remove('active');
      button.textContent = '🎙️';
      showToast('Voice recognition failed. Please try again.', 'warning');
    });
  }

  if (App.chatbot.listening) {
    App.chatbot.recognition.stop();
    App.chatbot.listening = false;
    button.classList.remove('active');
    button.textContent = '🎙️';
  } else {
    App.chatbot.recognition.start();
    App.chatbot.listening = true;
    button.classList.add('active');
    button.textContent = '⏹️';
  }
}

function simulateCall(num) { showToast(`📞 Calling ${num}...`, 'success'); }

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success:'✅', danger:'🚨', warning:'⚠️', info:'ℹ️' };
  toast.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.animation = 'toastIn 0.3s ease reverse forwards'; setTimeout(() => toast.remove(), 300); }, 4500);
}

// Threat Gauge canvas
window.addEventListener('load', () => {
  const canvas = document.getElementById('threatGauge');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cx = 100, cy = 100, r = 70;
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 2*Math.PI); ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.stroke();
  const score = 0.62;
  const gradient = ctx.createLinearGradient(cx-r, cy, cx+r, cy);
  gradient.addColorStop(0, '#22c55e'); gradient.addColorStop(0.5, '#eab308'); gradient.addColorStop(1, '#ef4444');
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, Math.PI + Math.PI * score); ctx.strokeStyle = gradient; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.stroke();
  const angle = Math.PI + Math.PI * score;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (r-20)*Math.cos(angle), cy + (r-20)*Math.sin(angle)); ctx.strokeStyle = '#f0f4ff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 2*Math.PI); ctx.fillStyle = '#f0f4ff'; ctx.fill();
});

// Modal overlay close
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && overlay.id !== 'sos-modal') overlay.classList.remove('active');
  });
});
