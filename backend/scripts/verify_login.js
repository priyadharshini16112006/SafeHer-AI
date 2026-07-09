const fetch = global.fetch || require('node-fetch');
(async () => {
  try {
    const res = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'priya@safeher.ai', password: 'password123', role: 'user' })
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', data);
    process.exit(0);
  } catch (err) {
    console.error('Request failed:', err);
    process.exit(1);
  }
})();
