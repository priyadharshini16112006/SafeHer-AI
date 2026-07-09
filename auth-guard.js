/* ============================================================
   SafeHer AI — Auth Guard
   auth-guard.js  |  Runs BEFORE app.js on index.html
   - Redirects unauthenticated users to auth.html
   - Injects user info & logout button into the header
   ============================================================ */

 (function () {
  'use strict';

  const STORAGE_KEY = 'safeher_auth';
  const AUTH_PAGE   = '/auth.html';

  /* ── Read session ── */
  function getSession() {
    const raw = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  function isTokenValid(token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 > Date.now();
    } catch { return false; }
  }

  function clearSession() {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
  }

  /* ── Guard check ── */
  const session = getSession();

  if (!session || !session.token || !isTokenValid(session.token)) {
    clearSession();
    window.location.href = AUTH_PAGE;
    // Stop all further script execution on this page
    throw new Error('[SafeHer Auth] Session expired — redirecting to login.');
  }

  /* ── User is authenticated — inject UI ── */
  const user = session.user || {};

  const ROLE_LABELS = {
    user:   { label: 'User',        emoji: '👩', color: 'linear-gradient(135deg,#f857a6,#a855f7)' },
    police: { label: 'Police',      emoji: '👮', color: 'linear-gradient(135deg,#06b6d4,#3b82f6)' },
    ngo:    { label: 'NGO',         emoji: '🤝', color: 'linear-gradient(135deg,#22c55e,#06b6d4)' },
  };
  const roleInfo = ROLE_LABELS[user.role] || ROLE_LABELS.user;

  /* Inject styles for guard elements */
  const style = document.createElement('style');
  style.textContent = `
    .guard-user-info {
      display: flex; align-items: center; gap: 10px; cursor: pointer;
      position: relative;
    }
    .guard-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.78rem; font-weight: 700; color: #fff;
      background: ${roleInfo.color};
      flex-shrink: 0; box-shadow: 0 2px 10px rgba(248,87,166,0.35);
    }
    .guard-name-wrap { display: flex; flex-direction: column; line-height: 1.2; }
    .guard-name { font-size: 0.82rem; font-weight: 600; color: var(--text-primary); }
    .guard-role-badge {
      display: inline-flex; align-items: center; gap: 3px;
      font-size: 0.68rem; font-weight: 600; padding: 2px 7px; border-radius: 10px;
      background: ${roleInfo.color}; color: #fff; width: fit-content;
    }
    .guard-dropdown {
      position: absolute; top: calc(100% + 10px); right: 0;
      background: rgba(13,17,23,0.97);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px; padding: 8px;
      min-width: 200px; z-index: 9999;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5);
      display: none; animation: guardDropIn 0.2s ease;
      backdrop-filter: blur(20px);
    }
    .guard-dropdown.open { display: block; }
    @keyframes guardDropIn {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .guard-dd-header {
      padding: 10px 12px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      margin-bottom: 6px;
    }
    .guard-dd-name { font-weight: 600; font-size: 0.9rem; color: var(--text-primary, #f0f4ff); }
    .guard-dd-email { font-size: 0.75rem; color: rgba(240,244,255,0.5); margin-top: 2px; word-break: break-all; }
    .guard-logout-btn {
      display: flex; align-items: center; gap: 9px;
      width: 100%; padding: 10px 12px; border: none;
      border-radius: 8px; background: transparent;
      color: #fca5a5; font-size: 0.85rem; font-weight: 500;
      cursor: pointer; transition: background 0.2s;
      font-family: inherit;
    }
    .guard-logout-btn:hover { background: rgba(239,68,68,0.12); }
    @media (max-width: 500px) {
      .guard-name-wrap { display: none; }
    }
  `;
  document.head.appendChild(style);

  /* Inject user widget into header when DOM is ready */
  document.addEventListener('DOMContentLoaded', () => {
    const avatarEl = document.querySelector('.user-avatar');
    if (!avatarEl) return;

    const initials = user.avatar || (user.name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

    avatarEl.innerHTML = `
      <div class="guard-user-info" id="guard-user-widget" onclick="document.getElementById('guard-dropdown').classList.toggle('open')">
        <div class="guard-avatar">${initials}</div>
        <div class="guard-name-wrap">
          <span class="guard-name">${user.name || 'User'}</span>
          <span class="guard-role-badge">${roleInfo.emoji} ${roleInfo.label}</span>
        </div>
        <div class="guard-dropdown" id="guard-dropdown">
          <div class="guard-dd-header">
            <div class="guard-dd-name">${user.name || 'User'}</div>
            <div class="guard-dd-email">${user.email || ''}</div>
          </div>
          <button class="guard-logout-btn" onclick="AuthGuard.logout(event)" id="guard-logout-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign Out
          </button>
        </div>
      </div>`;

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const widget = document.getElementById('guard-user-widget');
      const dropdown = document.getElementById('guard-dropdown');
      if (widget && dropdown && !widget.contains(e.target)) {
        dropdown.classList.remove('open');
      }
    });
  });

  /* ── Public API (accessible by logout button) ── */
  window.AuthGuard = {
    async logout(e) {
      if (e) e.stopPropagation();
      clearSession();
        try {
          // Dynamically import the firebase module only when signing out so
          // this file can remain a classic script and won't break page loads.
          const mod = await import('./firebase.js');
          if (mod && mod.signOut && mod.auth) await mod.signOut(mod.auth);
        } catch (err) {
          console.warn('Firebase sign-out error:', err);
        }
      window.location.href = AUTH_PAGE;
    },
    getUser() { return session.user || {}; },
    getToken() { return session.token || ''; },
  };

})();
