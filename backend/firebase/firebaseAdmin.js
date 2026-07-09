const admin = require("firebase-admin");

try {
  const serviceAccount = require("./serviceAccountKey.json");
  const credential = admin.credential && typeof admin.credential.cert === 'function'
    ? admin.credential.cert(serviceAccount)
    : admin.cert(serviceAccount);
  admin.initializeApp({
    credential,
  });
} catch (error) {
  console.warn("⚠️  Firebase initialization failed:", error.message);
  console.warn("   Backend will run without Firebase functionality");
}

module.exports = admin;