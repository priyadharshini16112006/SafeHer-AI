const { db } = require('../database');
const bcrypt = require('bcrypt');
(async () => {
  try {
    const email = 'priya@safeher.ai';
    const user = await db.users.findOne({ email });
    if (!user) { console.log('User not found'); process.exit(0); }
    console.log('Found user:', user.email, user._id);
    const ok = await bcrypt.compare('password123', user.password || '');
    console.log('bcrypt compare result:', ok);
    process.exit(0);
  } catch (err) { console.error(err); process.exit(1); }
})();
