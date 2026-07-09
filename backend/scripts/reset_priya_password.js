const { db } = require('../database');
const bcrypt = require('bcrypt');
(async () => {
  try {
    const email = 'priya@safeher.ai';
    const hash = await bcrypt.hash('password123', 12);
    const user = await db.users.findOne({ email });
    if (!user) { console.log('User not found:', email); process.exit(0); }
    await db.users.update({ _id: user._id }, { $set: { password: hash } });
    console.log('Updated password for', email);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
