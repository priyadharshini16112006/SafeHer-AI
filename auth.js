
'use strict';
import {
  auth,
  googleProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult
} from "./firebase.js";

const AUTH_API  = 'http://localhost:5000/api/auth';
const DASHBOARD = 'index.html';
const STORAGE_KEY = 'safeher_auth';

/* ─── Session Storage Helpers ────────────────────────────────── */
const Session = {
  save(data, remember) {
    const store = remember ? localStorage : sessionStorage;
    // Clear the other one to avoid conflicts
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    store.setItem(STORAGE_KEY, JSON.stringify(data));
  },
  get() {
    const raw = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  },
  clear() {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
  },
  isValid() {
    const s = Session.get();
    if (!s || !s.token) return false;
    try {
      // Decode JWT payload without verification (verification happens server-side)
      const payload = JSON.parse(atob(s.token.split('.')[1]));
      return payload.exp * 1000 > Date.now();
    } catch { return false; }
  },
};

/* ─── Main Auth Controller ───────────────────────────────────── */
const Auth = {
  currentRole: 'user',
  currentMethod: 'email',
  otpSent: false,

  /* ── Init ── */
  init() {
    // If already logged in, redirect to dashboard
    if (Session.isValid()) {
      window.location.href = DASHBOARD;
      return;
    }
    // Wire up OTP digit navigation
    Auth._initOTPDigits();
    Auth._handleRedirectResult();
    Auth._checkResetLink();
  },

  /* ── Panel switcher ── */
  showPanel(name) {
    document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(`panel-${name}`);
    if (el) el.classList.add('active');
    // Clear alerts
    ['login-alert','signup-alert','forgot-alert'].forEach(id => Auth._hideAlert(id));
  },


  /* ── Role tabs ── */
  setRole(role) {
    Auth.currentRole = role;
    document.querySelectorAll('.role-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${role}`)?.classList.add('active');

    // Update placeholder email hint
    const emailInput = document.getElementById('login-email');
    if (!emailInput) return;
    const hints = {
      user:   'priya@safeher.ai',
      police: 'inspector@safeher.ai',
      ngo:    'ngo@safeher.ai',
    };
    emailInput.placeholder = hints[role] || 'you@example.com';
  },

  /* ── Login method tabs (email / otp) ── */
  setMethod(method) {
    Auth.currentMethod = method;
    document.getElementById('method-email').classList.toggle('active', method === 'email');
    document.getElementById('method-otp').classList.toggle('active', method === 'otp');
    document.getElementById('email-login-form').style.display = method === 'email' ? '' : 'none';
    document.getElementById('otp-login-form').style.display   = method === 'otp'   ? '' : 'none';
    Auth._hideAlert('login-alert');
  },

  /* ── Email / Password Login ── */
  async loginWithEmail(e) {
    e.preventDefault();
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const remember = document.getElementById('remember-me').checked;
    const role     = Auth.currentRole;
    const btn      = document.getElementById('login-btn');

    if (!email || !password) { Auth._showAlert('login-alert', 'Please enter email and password.', 'error'); return; }

    Auth._setLoading(btn, true, 'Signing in…');
    Auth._hideAlert('login-alert');

    try {
      const res = await Auth._post('/login', { email, password, role });
      if (res.success) {
        Session.save({ token: res.token, user: res.user }, remember);
        Auth._showAlert('login-alert', `Welcome back, ${res.user.name}! Redirecting…`, 'success');
        setTimeout(() => window.location.href = DASHBOARD, 900);
      } else {
        Auth._showAlert('login-alert', res.message || 'Login failed.', 'error');
      }
    } catch {
      Auth._showAlert('login-alert', 'Unable to connect to server. Please try again.', 'error');
    } finally {
      Auth._setLoading(btn, false, 'Sign In');
    }
  },

  /* ── OTP Flow ── */
  async sendOTP() {
    const rawPhone = document.getElementById('otp-phone').value.trim();
    const btn      = document.getElementById('send-otp-btn');
    const digits   = rawPhone.replace(/\D/g, '');
    const phone    = '+91' + digits;

    if (digits.length !== 10) {
      Auth._showAlert('login-alert', 'Enter a valid 10-digit mobile number.', 'error');
      return;
    }

    Auth._setLoading(btn, true, 'Sending…');
    Auth._hideAlert('login-alert');

    try {
      const res = await Auth._post('/otp/send', { phone });
      if (res.success) {
        Auth.otpSent = true;
        document.getElementById('otp-code-group').style.display = '';
        document.getElementById('otp-d1').focus();
        btn.textContent = 'Resend';
        btn.disabled = false;

        const message = res.otp ? `${res.message} (OTP: ${res.otp})` : res.message;
        Auth._showAlert('login-alert', message, 'success');
        if (res.otp) {
          const debugEl = document.getElementById('otp-debug');
          if (debugEl) {
            debugEl.style.display = '';
            debugEl.textContent = `Development OTP: ${res.otp}`;
          }
        }
      } else {
        Auth._showAlert('login-alert', res.message, 'info');
      }
    } catch {
      Auth._showAlert('login-alert', 'OTP service is temporarily unavailable. Please use email login or Google sign-in.', 'info');
    } finally {
      Auth._setLoading(btn, false, 'Resend');
    }
  },

  async loginWithOTP(e) {
    e.preventDefault();
    if (!Auth.otpSent) { Auth._showAlert('login-alert', 'Please send OTP first.', 'error'); return; }

    const phone = '+91' + document.getElementById('otp-phone').value.trim();
    const otp   = ['otp-d1','otp-d2','otp-d3','otp-d4','otp-d5','otp-d6']
                    .map(id => document.getElementById(id).value).join('');
    const btn   = document.getElementById('otp-verify-btn');

    if (otp.length < 6) { Auth._showAlert('login-alert', 'Enter all 6 OTP digits.', 'error'); return; }

    Auth._setLoading(btn, true, 'Verifying…');

    try {
      const res = await Auth._post('/otp/verify', { phone, otp });
      if (res.success) {
        Session.save({ token: res.token, user: res.user }, false);
        Auth._showAlert('login-alert', `Verified! Welcome, ${res.user.name}!`, 'success');
        setTimeout(() => window.location.href = DASHBOARD, 900);
      } else {
        Auth._showAlert('login-alert', res.message, 'error');
      }
    } catch {
      Auth._showAlert('login-alert', 'Verification failed. Please retry.', 'error');
    } finally {
      Auth._setLoading(btn, false, 'Verify OTP');
    }
  },

  /* ── Google Sign-In (simulated) ── */
  async loginWithGoogle() {
    const btn = document.getElementById("google-login-btn");
    if (btn) btn.disabled = true;

    try {
      const result = await signInWithPopup(auth, googleProvider);
      await Auth._handleGoogleSignInResult(result);
    } catch (err) {
      console.error(err);
      const code = err?.code || '';
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/cancelled-popup-request') {
        Auth._showAlert('login-alert', 'Popup blocked. Redirecting to Google sign-in...', 'info');
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      Auth._showAlert('login-alert', 'Google Sign-In failed. Please try again.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async _handleRedirectResult() {
    try {
      const result = await getRedirectResult(auth);
      if (result?.user) {
        await Auth._handleGoogleSignInResult(result);
      } else if (auth.currentUser) {
        // Clear any stale Firebase session if no redirect result is available.
        await signOut(auth);
      }
    } catch (err) {
      console.error('Redirect result error:', err);
      const code = err?.code || '';
      if (code === 'auth/no-auth-event') {
        if (auth.currentUser) {
          await signOut(auth);
        }
        return;
      }
      // Avoid showing this redirect failure message on the Sign Up panel
      const signupPanel = document.getElementById('panel-signup');
      const isSignupActive = signupPanel && signupPanel.classList.contains('active');
      if (!isSignupActive) {
        // Intentionally suppress redirect failure alert on login page
      }
    }
  },

  async _handleGoogleSignInResult(result) {
    const user = result?.user || auth.currentUser;
    if (!user) {
      Auth._showAlert('login-alert', 'Google Sign-In did not return a valid user.', 'error');
      return;
    }

    try {
      const idToken = await user.getIdToken();
      const res = await Auth._post('/google', { idToken });
      if (res.success) {
        Session.save({ token: res.token, user: res.user }, false);
        window.location.href = DASHBOARD;
      } else {
        Auth._showAlert('login-alert', res.message || 'Invalid Google token.', 'error');
      }
    } catch (err) {
      console.error('Google token verification error:', err);
      Auth._showAlert('login-alert', 'Invalid Google token.', 'error');
    }
  },

  /* ── Register ── */
  async register(e) {
    e.preventDefault();
    const name     = document.getElementById('signup-name').value.trim();
    const email    = document.getElementById('signup-email').value.trim();
    const phone    = document.getElementById('signup-phone').value.trim();
    const role     = document.getElementById('signup-role').value;
    const password = document.getElementById('signup-password').value;
    const confirm  = document.getElementById('signup-confirm').value;
    const btn      = document.getElementById('signup-btn');

    if (!name || !email || !password) { Auth._showAlert('signup-alert', 'Please fill all required fields.', 'error'); return; }
    if (password !== confirm)         { Auth._showAlert('signup-alert', 'Passwords do not match.', 'error'); return; }
    if (password.length < 6)         { Auth._showAlert('signup-alert', 'Password must be at least 6 characters.', 'error'); return; }

    Auth._setLoading(btn, true, 'Creating account…');
    Auth._hideAlert('signup-alert');

    try {
      const res = await Auth._post('/register', { name, email, phone, role, password });
      if (res.success) {
        Session.save({ token: res.token, user: res.user }, false);
        Auth._showAlert('signup-alert', `Account created! Welcome, ${res.user.name}!`, 'success');
        setTimeout(() => window.location.href = DASHBOARD, 1000);
      } else {
        Auth._showAlert('signup-alert', res.message || 'Registration failed.', 'error');
      }
    } catch {
      Auth._showAlert('signup-alert', 'Unable to connect. Please try again.', 'error');
    } finally {
      Auth._setLoading(btn, false, 'Create Account');
    }
  },

  /* ── Forgot Password ── */
  async forgotPassword(e) {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    const btn   = document.getElementById('forgot-btn');

    if (!email) { Auth._showAlert('forgot-alert', 'Please enter your email address.', 'error'); return; }

    Auth._setLoading(btn, true, 'Sending…');
    Auth._hideAlert('forgot-alert');

    try {
      const res = await Auth._post('/forgot-password', { email });
      Auth._showAlert('forgot-alert', res.message, res.success ? 'success' : 'error');
      // Do not display any sample reset tokens
    } catch {
      Auth._showAlert('forgot-alert', 'Unable to connect. Please try again.', 'error');
    } finally {
      Auth._setLoading(btn, false, 'Send Reset Link');
    }
  },

  async resetPassword(e) {
    e.preventDefault();
    const email = document.getElementById('reset-email')?.value.trim();
    const token = document.getElementById('reset-token')?.value;
    const password = document.getElementById('reset-password-new')?.value;
    const btn = document.getElementById('reset-btn');

    if (!email || !token || !password) {
      Auth._showAlert('reset-alert', 'Please complete all reset fields.', 'error');
      return;
    }
    if (password.length < 6) {
      Auth._showAlert('reset-alert', 'Password must be at least 6 characters.', 'error');
      return;
    }

    Auth._setLoading(btn, true, 'Resetting…');
    Auth._hideAlert('reset-alert');

    try {
      const res = await Auth._post('/reset-password', { email, token, password });
      if (res.success) {
        Auth._showAlert('reset-alert', res.message, 'success');
        setTimeout(() => Auth.showPanel('login'), 1300);
      } else {
        Auth._showAlert('reset-alert', res.message || 'Reset failed.', 'error');
      }
    } catch {
      Auth._showAlert('reset-alert', 'Unable to connect. Please try again.', 'error');
    } finally {
      Auth._setLoading(btn, false, 'Reset Password');
    }
  },

  _checkResetLink() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset') !== 'true') return;

    const token = params.get('token');
    const email = params.get('email');
    if (!token || !email) return;

    const tokenEl = document.getElementById('reset-token');
    const emailEl = document.getElementById('reset-email');
    if (tokenEl) tokenEl.value = token;
    if (emailEl) {
      emailEl.value = email;
      emailEl.readOnly = true;
    }
    Auth.showPanel('reset');
    window.history.replaceState({}, document.title, window.location.pathname);
  },

  /* ── Password Visibility Toggle ── */
  togglePassword(inputId, btnEl) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';

    const eyeOpen  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const eyeClosed = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

    const target = typeof btnEl === 'string' ? document.getElementById(btnEl) : btnEl;
    if (target) target.innerHTML = isHidden ? eyeClosed : eyeOpen;
  },

  /* ── Password Strength ── */
  checkPasswordStrength(pwd) {
    const strengthEl = document.getElementById('pwd-strength');
    const labelEl    = document.getElementById('pwd-label');
    if (!strengthEl) return;

    if (!pwd) { strengthEl.style.display = 'none'; return; }
    strengthEl.style.display = '';

    let score = 0;
    if (pwd.length >= 6)  score++;
    if (pwd.length >= 10) score++;
    if (/[A-Z]/.test(pwd) && /[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    const segs  = ['ps1','ps2','ps3','ps4'];
    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    const cls    = ['', 'weak', 'medium', 'medium', 'strong'];

    segs.forEach((id, i) => {
      const el = document.getElementById(id);
      el.className = 'pwd-bar-seg' + (i < score ? ` ${cls[score]}` : '');
    });
    labelEl.textContent = labels[score] || '';
    labelEl.style.color = score <= 1 ? 'var(--danger)' : score <= 2 ? 'var(--warning)' : 'var(--success)';
  },

  /* ── OTP digit keyboard navigation ── */
  _initOTPDigits() {
    const ids = ['otp-d1','otp-d2','otp-d3','otp-d4','otp-d5','otp-d6'];
    ids.forEach((id, i) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        if (el.value && i < ids.length - 1) document.getElementById(ids[i+1]).focus();
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !el.value && i > 0) {
          document.getElementById(ids[i-1]).focus();
        }
      });
      el.addEventListener('paste', (e) => {
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g,'');
        ids.forEach((iid, j) => {
          const d = document.getElementById(iid);
          if (d) d.value = paste[j] || '';
        });
        document.getElementById(ids[Math.min(paste.length, ids.length-1)])?.focus();
      });
    });
  },

  /* ── Private helpers ── */
  async _post(endpoint, body) {
    const res = await fetch(AUTH_API + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data;
  },

  _showAlert(id, msg, type = 'error') {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `auth-alert ${type} active`;
    el.innerHTML = `<span>${type === 'error' ? '⚠️' : type === 'success' ? '✓' : 'ℹ️'}</span><span>${msg}</span>`;
  },

  _hideAlert(id) {
    const el = document.getElementById(id);
    if (el) { el.className = 'auth-alert'; el.innerHTML = ''; }
  },

  _setLoading(btn, loading, text) {
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading ? `<span class="btn-spinner"></span> ${text}` : text;
  },
};

/* ─── Boot ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => Auth.init());
window.Auth = Auth;
