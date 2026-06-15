const { Pool } = require('pg');
require('dotenv').config();

console.log('🔍 Тест подключения к PostgreSQL...');
console.log('Хост:', process.env.DB_HOST);
console.log('Порт:', process.env.DB_PORT);
console.log('Пользователь:', process.env.DB_USER);
console.log('Пароль:', process.env.DB_PASSWORD ? '***' : 'не указан');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: 'postgres',
  connectionTimeoutMillis: 5000
});

pool.connect()
  .then(client => {
    console.log('Подключение успешно!');
    return client.query('SELECT version()');
  })
  .then(result => {
    console.log('Версия PostgreSQL:', result.rows[0].version);
    return pool.end();
  })
  .then(() => {
    console.log('Тест завершен успешно!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Ошибка:', err.message);
    if (err.code === '28P01') {
      console.log('\nНеверный пароль пользователя postgres');
      console.log('Попробуйте сбросить пароль через pgAdmin или командой:');
      console.log('ALTER USER postgres PASSWORD <новый пароль>');
    }
    process.exit(1);
  });