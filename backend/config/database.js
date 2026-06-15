var { Pool } = require('pg');
require('dotenv').config();

// настройки подключения к postgres
var pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'helpdesk',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD /* пароль вставляется через .env */
});

// проверим что коннект работает
pool.query('SELECT NOW()')
  .then(function() {
    console.log('Подключено к базе helpdesk');
  })
  .catch(function(err) {
    console.error('Ошибка подключения:', err.message);
  });

module.exports = pool;