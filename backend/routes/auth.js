/* ============================================================
   SafeHer AI — Authentication Routes
   backend/routes/auth.js
   ============================================================ */
const admin = require("../firebase/firebaseAdmin");
const { getAuth } = require('firebase-admin/auth');
const express = require('express');
const router  = express.Router();

function getFirebaseAdminAuth() {
  try {
    if (admin.getApps && admin.getApps().length) {
      return getAuth(admin.getApp());
    }
    return null;
  } catch (err) {
    console.warn('Firebase auth helper failed:', err && err.message ? err.message : err);
    return null;
  }
}
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcrypt');
const nodemailer = require('nodemailer');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'safeher_ai_super_secret_key_2024';
const JWT_EXPIRES = '7d';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const APP_URL = process.env.APP_URL || `http://localhost:${process.env.PORT || 5000}`;

function openBrowser(url) {
  if (!url) return;
  const platform = process.platform;
  const command = platform === 'win32'
    ? `start "" "${url}"`
    : platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(command, (err) => {
    if (err) console.warn('Unable to open browser preview URL:', err.message);
  });
}

async function getMailTransporter() {
  if (process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS) {
    return nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: parseInt(process.env.MAIL_PORT || '587', 10),
      secure: process.env.MAIL_SECURE === 'true',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });
  }

  if (process.env.NODE_ENV !== 'production') {
    if (!global.__ETHEREAL_TRANSPORTER) {
      const testAccount = await nodemailer.createTestAccount();
      global.__ETHEREAL_TRANSPORTER = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      global.__ETHEREAL_ACCOUNT = testAccount;
    }
    return global.__ETHEREAL_TRANSPORTER;
  }

  return null;
}

async function sendPasswordResetEmail(toEmail, token) {
  const transporter = await getMailTransporter();
  if (!transporter) {
    console.log(`🔔 Mail not configured. Reset token for ${toEmail}: ${token}`);
    return false;
  }

  const resetUrl = `${APP_URL}/auth.html?reset=true&token=${encodeURIComponent(token)}&email=${encodeURIComponent(toEmail)}`;
  const fromAddress = process.env.MAIL_FROM || `no-reply@${new URL(APP_URL).hostname}`;

  const html = `
    <p>Hi,</p>
    <p>We received a request to reset the password for <strong>${toEmail}</strong>.</p>
    <p>Click the button below to reset your password:</p>
    <p><a href="${resetUrl}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none;">Reset Password</a></p>
    <p>If you did not request this, you can safely ignore this email.</p>
    <p>Thank you,<br/>SafeHer AI Team</p>
  `;

  const info = await transporter.sendMail({
    from: fromAddress,
    to: toEmail,
    subject: 'SafeHer AI Password Reset',
    html,
  });

  if (global.__ETHEREAL_ACCOUNT) {
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`🔔 Opening Ethereal preview URL in browser: ${previewUrl}`);
      openBrowser(previewUrl);
    }
  }

  return true;
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return phone;
}

function getPhoneVariants(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  const digits = normalized.replace(/\D/g, '');
  const raw10 = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return [normalized, raw10].filter(Boolean);
}

// ── Helpers ──────────────────────────────────────────────────
function makeToken(user) {
  return jwt.sign(
    { id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone || null },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function sanitize(user) {
  const { password, otp, otpExpiry, googleId, ...safe } = user;
  return safe;
}

// In-memory OTP store { phone: { code, expiry } }
const otpStore = {};

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password are required.' });


    const emailLower = email.toLowerCase();
    const query = role ? { email: emailLower, role } : { email: emailLower };
    let user = await db.users.findOne(query);
    // If role-specific lookup failed, fall back to email-only lookup so users aren't rejected
    // when the selected role tab doesn't match their stored role.
    if (!user && role) {
      user = await db.users.findOne({ email: emailLower });
    }
    if (!user || !user.password) return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    const token = makeToken(user);
    res.json({ success: true, message: 'Login successful!', token, user: sanitize(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ── POST /api/auth/register ───────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, role = 'user' } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Name, email and password are required.' });
    if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    const emailLower = String(email).toLowerCase().trim();
    const existing = await db.users.findOne({ email: emailLower });
    if (existing) return res.status(409).json({ success: false, message: 'An account with this email already exists.' });

    const validRoles = ['user', 'police', 'ngo'];
    const safeRole = validRoles.includes(role) ? role : 'user';

    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const normalizedPhone = normalizePhone(phone);

    const newUser = {
      _id: uuidv4(),
      name: String(name).trim(),
      email: emailLower,
      password: hashed,
      phone: normalizedPhone,
      role: safeRole,
      avatar: String(name).trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
      created_at: new Date().toISOString(),
    };

    await db.users.insert(newUser);
    const token = makeToken(newUser);
    res.status(201).json({ success: true, message: 'Account created successfully!', token, user: sanitize(newUser) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ── POST /api/auth/otp/send ───────────────────────────────────
router.post('/otp/send', async (req, res) => {
  try {
    let { phone } = req.body;
    phone = normalizePhone(phone);
    if (!phone || phone.length < 10) return res.status(400).json({ success: false, message: 'Valid phone number is required.' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiry = Date.now() + 5 * 60 * 1000; // 5 min
    otpStore[phone] = { code, expiry };

    console.log(`📱 OTP for ${phone}: ${code}`); // In production, send via SMS

    const response = {
      success: true,
      message: `OTP sent to ${phone.replace(/.(?=.{4})/g, '*')}`,
    };
    if (process.env.NODE_ENV !== 'production') {
      response.otp = code;
    }

    res.json(response);
  } catch (err) {
    console.error('OTP send error:', err);
    res.status(500).json({ success: false, message: 'Failed to send OTP.' });
  }
});

// ── POST /api/auth/otp/verify ─────────────────────────────────
router.post('/otp/verify', async (req, res) => {
  try {
    let { phone, otp } = req.body;
    phone = normalizePhone(phone);
    if (!phone || !otp) return res.status(400).json({ success: false, message: 'Phone and OTP are required.' });

    const record = otpStore[phone];
    if (!record) return res.status(400).json({ success: false, message: 'OTP not found. Please request again.' });
    if (Date.now() > record.expiry) {
      delete otpStore[phone];
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request again.' });
    }
    if (record.code !== otp) return res.status(400).json({ success: false, message: 'Invalid OTP. Please try again.' });

    delete otpStore[phone];

    // Only allow OTP verification for existing, registered users
    const users = await db.users.find({ phone: { $in: getPhoneVariants(phone) } });
    const user = users && users.length ? users[0] : null;
    if (!user) {
      return res.status(401).json({ success: false, message: 'No account found for this phone. Please register first.' });
    }

    const token = makeToken(user);
    res.json({ success: true, message: 'Phone verified!', token, user: sanitize(user) });
  } catch (err) {
    console.error('OTP verify error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/auth/google ─────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "Firebase ID token is required."
      });
    }

    const authClient = getFirebaseAdminAuth();
    if (!authClient) {
      return res.status(503).json({
        success: false,
        message: 'Firebase admin not initialized. Google sign-in is temporarily unavailable.'
      });
    }

    const decodedToken = await authClient.verifyIdToken(idToken);

    const email = decodedToken.email?.toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email not found in Google account."
      });
    }

    const user = await db.users.findOne({ email });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "No account found. Please register first."
      });
    }

    const token = makeToken(user);

    res.json({
      success: true,
      message: "Google Sign-In successful!",
      token,
      user: sanitize(user)
    });

  } catch (err) {
    console.error("Firebase Google Auth Error:", err);

    res.status(401).json({
      success: false,
      message: err.code ? `Firebase auth failed: ${err.code}` : "Invalid Google token.",
      error: err.message || null
    });
  }
});

// ── POST /api/auth/forgot-password ────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

    const emailLower = email.toLowerCase();
    const user = await db.users.findOne({ email: emailLower });
    const resetToken = uuidv4().slice(0, 8).toUpperCase();
    let emailSent = false;

    if (user) {
      await db.users.update({ _id: user._id }, { $set: {
        resetToken,
        resetTokenExpiry: Date.now() + 1000 * 60 * 30,
      }});
      emailSent = await sendPasswordResetEmail(emailLower, resetToken);
      if (!emailSent) {
        console.log(`🔑 Password reset for ${emailLower}: token = ${resetToken}`);
      }
    }

    res.json({
      success: true,
      message: emailSent
        ? `If an account exists for ${email}, a reset link has been sent.`
        : `If an account exists for ${email}, password reset instructions are being processed. Please configure SMTP for email delivery.`,
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authenticated.' });
    }
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await db.users.findOne({ _id: payload.id });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, user: sanitize(user) });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
});

module.exports = router;
