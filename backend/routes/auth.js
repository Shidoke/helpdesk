const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const pool = require('../config/database');
const { generateTokens, authenticateToken, authorizeRole, JWT_REFRESH_SECRET } = require('../middleware/auth');

// Регистрация
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, department } = req.body; // проверяется что все поля заполнены

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }
// проверим что такого email еще нет в базе
    var existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1', [email]
    );
    // если email уже есть, то 400
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email уже используется' });
    }
    // хэшируем пароль перед сохранением в базу
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, department, role)
       VALUES ($1, $2, $3, $4, 'user')
       RETURNING id, name, email, role, department`,
      [name, email, passwordHash, department || 'General']
    );

    const user = result.rows[0];
    const tokens = generateTokens(user);

    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')',
      [user.id, tokens.refreshToken]
    );

    res.status(201).json({ message: 'Регистрация успешна', user, ...tokens });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка! Регистрация не прошла' });
  }
});

// Вход
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
  // проверим что email и пароль не пустые
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    // создается токен и сохраняется рефреш токен в базу данных
    const tokens = generateTokens(user);
    
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')',
      [user.id, tokens.refreshToken]
    );
// обновим дату последнего входа
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    res.json({
      message: 'Вход выполнен',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department
      },
      ...tokens 
    }); 
  } catch (error) {
    res.status(500).json({ error: 'Входу отказан!' });
  }
});

// Обновление токена
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    // проверим что рефреш токен есть и он действительный
    var tokenResult = await pool.query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
      [refreshToken]
    );
    // если токен не найден или истек, то 403
    if (tokenResult.rows.length === 0) {
      return res.status(403).json({ error: 'Недействительный refresh token' });
    }
  
    jwt.verify(refreshToken, JWT_REFRESH_SECRET, async (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: 'Refresh token истек' });
      }
      // если токен действительный, то находится пользователь и создается новый access token (вместе с заменой старого refresh token)
      var userResult = await pool.query(
        'SELECT * FROM users WHERE id = $1 AND is_active = true',
        [decoded.id]
      );

      if (userResult.rows.length === 0) {
        return res.status(403).json({ error: 'Пользователь не найден' });
      }
      
      var user = userResult.rows[0];
      await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);

      var tokens = generateTokens(user);
      await pool.query(
        'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')',
        [user.id, tokens.refreshToken]
      );

      // возвращаем новый access token и refresh token

      res.json(tokens);
    }); 
  } catch (error) {
    res.status(500).json({ error: 'ошибка, проверьте работоспособность токена!' });
  }
});

// профиль
router.get('/profile', authenticateToken, async (req, res) => { 
  try { 
    var user = await pool.query( // получаем данные профиля из базы данных по id
      'SELECT id, name, email, role, department, last_login, created_at FROM users WHERE id = $1',
      [req.user.id]
      
    );
    res.json(user.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка. Не получилось добавить данные профиля.' });
  }
});

// Выход
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);
    res.json({ message: 'Выход выполнен' });

  } catch (error) {
    res.status(500).json({ error: 'Ошибка! Выход не был произведен' });
  }
});

// Список пользователей (для агентов и админов)
router.get('/users', authenticateToken, authorizeRole('agent', 'admin'), async (req, res) => {
  try { 
    const { role } = req.query; 
    let query = 'SELECT id, name, email, role, department FROM users WHERE is_active = true';

    // если указан фильтр по роли, то добавляем его в запрос

    const params = [];
    if (role) {
      query += ' AND role = $1';
      params.push(role);
    }
    query += ' ORDER BY name';
    
    const result = await pool.query(query, params);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка. Не удалось получить доступ к users' });
  }
});

// Логи активности (для админа)
router.get('/activity', authenticateToken, authorizeRole('admin'), async (req, res) => {

  try {
    var result = await pool.query(
      'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 50'
    ); // получаем последние 50 строк из таблицы логов активности
    res.json(result.rows);
    } 
    catch (error) {
    console.error('Register error:', error.message);
    res.status(500).json({ error: 'ошибка! Логи не работают' });
  }
});

module.exports = router; // экспортируем роутер для использования в основном файле сервера