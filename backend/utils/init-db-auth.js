const { Pool } = require('pg'); 
const bcrypt = require('bcryptjs'); //bcrypt для хэширования
require('dotenv').config(); 

// Подключаемся к системной базе postgres
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD, // пароль ставите тот который указали для postgres или другого пользователя (в этом случае поменяйте предыдущю строку и информацию в .env)
  database: 'postgres'  // Подключаемся к системной базе
});
/* создаем функцию, которая будет вызываться лишь раз */
async function initializeDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('Подключение к PostgreSQL');
    
    // Проверяем существование базы данных
    const dbExists = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = 'helpdesk'"
    );
    // если нету то создаем, либо выдаст "база данных уже создана"
    if (dbExists.rows.length === 0) {
      console.log('Создаем базу данных helpdesk...');
      await client.query('CREATE DATABASE helpdesk');
      console.log('База данных helpdesk создана');
    } else {
      console.log('База данных helpdesk уже создана, произошла ошибка!');
    }
    
    client.release();
    
    // Подключаемся к базе еще раз но у же к helpdesk чтобы с ним взаимодействовать
    const helpdeskPool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      database: 'helpdesk'
    });
    
    console.log('📊 Создаем таблицы...');
    
    // Создаем таблицы 
    await helpdeskPool.query(`
      
      -- Таблица юзеров (всех ролей)

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'agent', 'admin')),
        department VARCHAR(50) DEFAULT 'General',
        is_active BOOLEAN DEFAULT true,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Таблица хранения refresh токенов

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(500) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Таблица хранения тикетов

      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        ticket_number VARCHAR(20) UNIQUE NOT NULL,
        subject VARCHAR(200) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'Open' CHECK (status IN ('Open', 'Pending', 'Resolved', 'Closed')),
        priority VARCHAR(20) DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
        category VARCHAR(50) DEFAULT 'Other',
        requester_id INTEGER REFERENCES users(id),
        assignee_id INTEGER REFERENCES users(id),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Таблица хранения комментариев
      CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log('Таблицы созданы');
    
    // Создаем тестовых пользователей
    console.log('Создаем тестовых пользователей!');
    /* хэшируем вставленные в таблицу пароли */
    const adminHash = await bcrypt.hash('admin123', 10);
    const agentHash = await bcrypt.hash('agent123', 10);
    const userHash = await bcrypt.hash('user123', 10);

    await helpdeskPool.query(`
      INSERT INTO users (name, email, password_hash, role, department) VALUES
        ('Администратор', 'admin@helpdesk.com', $1, 'admin', 'IT'),
        ('Мария Сидорова', 'agent@helpdesk.com', $2, 'agent', 'Support'),
        ('Иван Петров', 'user@helpdesk.com', $3, 'user', 'Marketing')
      ON CONFLICT (email) DO NOTHING
    `, [adminHash, agentHash, userHash]); // при этом здесь сразу же используется hash

    // делаем образцовые тикеты для наглядного просмотра работоспособности тикетов
    console.log('Создаем тестовые тикеты...');
    
    const users = await helpdeskPool.query(
      "SELECT id, email FROM users WHERE email IN ('admin@helpdesk.com', 'agent@helpdesk.com', 'user@helpdesk.com')"
    );
    /*привязываем email к константам */
    const adminUser = users.rows.find(u => u.email === 'admin@helpdesk.com');
    const agentUser = users.rows.find(u => u.email === 'agent@helpdesk.com');
    const normalUser = users.rows.find(u => u.email === 'user@helpdesk.com');

    const tickets = [
      ['T-1001', 'Проблема с VPN подключением', 'Не могу подключиться к корпоративному VPN', 'Open', 'High', 'Network', normalUser.id, agentUser.id],
      ['T-1002', 'Не работает корпоративная почта', 'Outlook не отправляет письма с утра', 'Pending', 'Medium', 'Software', normalUser.id, agentUser.id],
      ['T-1003', 'Принтер на 3 этаже не отвечает', 'Принтер HP LaserJet не печатает', 'Resolved', 'Low', 'Hardware', adminUser.id, agentUser.id],
      ['T-1004', 'Запрос на доступ к общей папке', 'Нужен доступ к папке маркетинга', 'Closed', 'Low', 'Account', normalUser.id, adminUser.id],
      ['T-1005', 'Замена клавиатуры', 'Клавиатура залипает при наборе', 'Open', 'Medium', 'Hardware', normalUser.id, null],
    ];

    for (const ticket of tickets) {
      await helpdeskPool.query(
        `INSERT INTO tickets (ticket_number, subject, description, status, priority, category, requester_id, assignee_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (ticket_number) DO NOTHING`,
        [ticket[0], ticket[1], ticket[2], ticket[3], ticket[4], ticket[5], ticket[6], ticket[7], ticket[6]]
      );
    }

    console.log('\n✅ Инициализация базы данных завершена!');
    console.log('📋 Тестовые аккаунты:');
    console.log('admin@helpdesk.com / admin123 (администратор)');
    console.log('agent@helpdesk.com / agent123 (агент поддержки)');
    console.log('user@helpdesk.com / user123 (пользователь)');
    
    await helpdeskPool.end();
    
  } catch (error) {
    console.error(' Ошибка:', error.message);
    if (error.code === '28P01') {
      console.log('\nНеверный пароль! Проверьте DB_PASSWORD в .env файле');
      console.log('   Попробуйте:');
      console.log('   - Пустой пароль: DB_PASSWORD=');
      console.log('   - postgres: DB_PASSWORD=postgres');
      console.log('   - любого другого пользователя, для этого вставьте значения в .env и убедитесь что они созданы!');
    }
  } finally {
    await pool.end();
  }
}

initializeDatabase();