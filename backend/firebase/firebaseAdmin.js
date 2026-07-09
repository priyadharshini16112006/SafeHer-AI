const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

try {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const envPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const backendRoot = path.resolve(__dirname, '..');
  const candidatePaths = [
    envPath ? path.resolve(backendRoot, envPath) : null,
    envPath ? path.resolve(process.cwd(), envPath) : null,
    path.join(__dirname, "serviceAccountKey.json"),
    path.join(__dirname, "serviceAccount.json")
  ].filter(Boolean);

  if (process.env.NODE_ENV !== 'production') {
    console.log('🔎 Firebase admin candidate paths:', candidatePaths);
  }

  let serviceAccountPath = null;
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      serviceAccountPath = candidate;
      break;
    }
  }

  let serviceAccount = null;

  if (serviceAccountJson) {
    const payload = serviceAccountJson.trim();
    serviceAccount = payload.startsWith('{')
      ? JSON.parse(payload)
      : JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } else if (serviceAccountPath) {
    serviceAccount = require(serviceAccountPath);
  }

  if (!serviceAccount) {
    throw new Error('Firebase service account credentials not found. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON, or place serviceAccountKey.json/serviceAccount.json in backend/firebase.');
  }

  const credential = typeof admin.cert === 'function'
    ? admin.cert(serviceAccount)
    : admin.credential && typeof admin.credential.cert === 'function'
      ? admin.credential.cert(serviceAccount)
      : null;

  if (!credential) {
    throw new Error('Unable to create Firebase credential from service account.');
  }

  if (!admin.getApps || !admin.getApps().length) {
    admin.initializeApp({ credential });
    if (process.env.NODE_ENV !== 'production') {
      console.log('✅ Firebase admin initialized with service account:', serviceAccountPath || 'inline JSON');
    }
  } else if (process.env.NODE_ENV !== 'production') {
    console.log('ℹ️ Firebase admin already initialized.');
  }
} catch (error) {
  console.warn("⚠️  Firebase initialization failed:", error && error.stack ? error.stack : error);
  console.warn("   Backend will run without Firebase functionality");
}

module.exports = admin;
