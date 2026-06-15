const pool = require('../config/database');

async function check() {
  const users = await pool.query('SELECT name, email, role, telegram_id FROM users');
  console.table(users.rows);
  process.exit();
}

check();