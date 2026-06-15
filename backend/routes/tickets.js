const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { notifyNewComment, notifyNewTicket, notifyStatusChange } = require('../utils/notifications');

router.use(authenticateToken);

// Функция записи лога
async function logActivity(userName, action, details) {
  try {
    await pool.query(
      'INSERT INTO activity_log (user_name, action, details) VALUES ($1, $2, $3)',
      [userName, action, details]
    );
  } catch (err) {
    console.error('Ошибка логирования:');
  }
}

// Получение списка тикетов с фильтрацией и поиском
router.get('/', async (req, res) => {
  try {
    var { search, status, priority } = req.query; 
    let query = ` 
      SELECT t.*, 
             u1.name as requester_name, u1.email as requester_email,
             u2.name as assignee_name, u2.email as assignee_email,
             (SELECT COUNT(*) FROM comments WHERE ticket_id = t.id) as comment_count
      FROM tickets t
      LEFT JOIN users u1 ON t.requester_id = u1.id
      LEFT JOIN users u2 ON t.assignee_id = u2.id
      WHERE 1=1
    `; // 
    const params = [];
    let paramCount = 1; // 
    /*  если это юзер, то он видит только свои тикеты, он их так же может фильтровать. */
    if (req.user.role === 'user') { 
      query += ` AND t.requester_id = $${paramCount}`;
      params.push(req.user.id);
      paramCount++;
    }

    if (search) {  
      query += ` AND (t.subject ILIKE $${paramCount} OR t.description ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    if (status) { 
      query += ` AND t.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (priority) { 
      query += ` AND t.priority = $${paramCount}`;
      params.push(priority);
      paramCount++;
    }

    query += ' ORDER BY t.created_at DESC LIMIT 50'; // ограничение на 50 тикетов для оптимизации

    var result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка! Убедитесь что у вас есть подключение к базе данных' });
  }
});

// Создать тикет
router.post('/', async (req, res) => {
  try {
    const { subject, description, priority, category } = req.body; // добавляем категорию
    const ticketNumber = 'T-' + Date.now().toString().slice(-6);  // уникальный номер тикета создается на основе текущего времени
    
    const result = await pool.query( 
      `INSERT INTO tickets (ticket_number, subject, description, priority, category, requester_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`, 
      [ticketNumber, subject, description, priority || 'Medium', category || 'Other', req.user.id, req.user.id]
    ); 

    //  Уведомление агентам о новом тикете
    try {
      const { notifyNewComment, notifyNewTicket, notifyStatusChange } = require('../utils/notifications');
      notifyNewTicket(ticketNumber, subject, req.user.name).catch(err => 
        console.error('Ошибка уведомления:', err.message) // ошибка уведомления может быть, но тикет создастся, независимо от этого
      ); 
      
    } catch (err) {
      console.error('Модуль уведомлений не загружен:', err.message); 
    }
     await logActivity(req.user.name, 'Создал тикет', `#${ticketNumber} - "${subject}"`);
    /* В случае если что то меняется, то изменения закидываются в аудит, например как здесь */
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'уведомлене не отправлено, ошибка!' });
   
  }
});

// Обновить тикет
router.patch('/:id', authorizeRole('agent', 'admin'), async (req, res) => {
  try {
    const { id } = req.params; 
    const { subject, description, status, priority, assignee_email } = req.body; 
// формируем динамический запрос в зависимости от того, какие поля пришли для обновления
    let query = 'UPDATE tickets SET '; 
    const updates = [];
    const params = [];
    let paramCount = 1;
// если пришло поле для обновления, то он его добавляет в базу, если нет, то пропускает
    if (subject) {
      updates.push(`subject = $${paramCount++}`);
      params.push(subject); // для темы
    }

    if (description) {
      updates.push(`description = $${paramCount++}`);
      params.push(description); // для описания
    } 

    if (status) {
      updates.push(`status = $${paramCount++}`);
      params.push(status); // статуса 
    }

    if (priority) {
      updates.push(`priority = $${paramCount++}`);
      params.push(priority); // приоритета
    }

    if (assignee_email) { 
      updates.push(`assignee_id = (SELECT id FROM users WHERE email = $${paramCount++})`); // 
      params.push(assignee_email); 
    } else if (assignee_email === '') {
      updates.push(`assignee_id = NULL`);
    }
    // если нет полей для обновления, то возвращается ошибка
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }
    // формируется запрос на обновление, добавляются только те поля, которые пришли в запросе
    query += updates.join(', ');
    query += ` WHERE id = $${paramCount} RETURNING *`;
    params.push(id);
 // выполняется запрос на обновление тикета
    var result = await pool.query(query, params);
 
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Тикет не найден' }); // 404
    }

    // Уведомление о смене статуса
    if (status) {
      notifyStatusChange(id, status).catch(err => console.error(err));
    }
    // или здесь добавляется строка аудета
 await logActivity(req.user.name, 'Обновил тикет', `#${result.rows[0].ticket_number} - статус: ${status || '—'}, приоритет: ${priority || '—'}`);

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
 
});

// Удалить тикет (только для админа)
router.delete('/:id', authenticateToken, authorizeRole('admin'), async (request, resource) => {
  try {
    const result = await pool.query(
      'DELETE FROM tickets WHERE id = $1 RETURNING *',
      [request.params.id]
    );
    // если тикет удален, то 404
    if (result.rows.length === 0) {
      return resource.status(404).json({ error: 'Тикет не найден' });
    } 
     await logActivity(request.user.name, 'Удалил тикет', `#${result.rows[0].ticket_number}`); // добавляем строку в аудит лог, что тикет удален
    resource.json({ message: 'Тикет удален' });
  } catch (error) {
    resource.status(500).json({ error: 'Ошибка со стороны API!' });
  }

});
// получение комментария к тикету (для всех ролей)
router.get('/:id/comments', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Проверяем доступ к тикету
    var ticket = await pool.query(
      'SELECT * FROM tickets WHERE id = $1',
      [id]
    );
    
    if (ticket.rows.length === 0) {
      return res.status(404).json({ error: 'Тикет не найден' }); // 404
    }
    
    // Пользователь видит комментарии только к своим тикетам
    if (req.user.role === 'user' && ticket.rows[0].requester_id !== req.user.id) {
      return res.status(403).json({ error: 'Доступ запрещен' }); // 403 
    }
    var result = await pool.query(
      `SELECT c.*, u.name as author_name, u.role as author_role
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.ticket_id = $1
       ORDER BY c.created_at ASC`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Добавить комментарий
router.post('/:id/comments', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Текст комментария обязателен' }); 
    }
    
    // Проверяем доступ к тикету
    var ticket = await pool.query(
      'SELECT * FROM tickets WHERE id = $1',
      [id]
    );
  
    if (ticket.rows.length === 0) {
      return res.status(404).json({ error: 'Тикет не найден' }); // 404
    }
    
    // Пользователь может комментировать только свои тикеты
    if (req.user.role === 'user' && ticket.rows[0].requester_id !== req.user.id) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    var result = await pool.query(
      `INSERT INTO comments (ticket_id, user_id, text)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, req.user.id, text.trim()]
    );
    
    // Если комментирует агент/админ, то автоматически изменяется на "аппендинг" или "в прогрессе"
    if ((req.user.role === 'agent' || req.user.role === 'admin') && ticket.rows[0].status === 'Open') {
      await pool.query(
        'UPDATE tickets SET status = $1 WHERE id = $2',
        ['Pending', id]
      );
    }
    
    // Получаем полную информацию о комментарии 
   var comment = await pool.query(
      `SELECT c.*, u.name as author_name, u.role as author_role
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.id = $1`,
      [result.rows[0].id]
    );
    
    // Уведомление о новом комментарии
    try {
      const { notifyNewComment } = require('../utils/notifications');
      notifyNewComment(id, text.trim(), req.user.name);
    } catch(err) {
      console.error('Ошибка уведомления:', err.message);
    }
    
    await logActivity(req.user.name, 'Добавил комментарий', `К тикету #${ticket.rows[0].ticket_number}`);

    res.status(201).json(comment.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
  
});

module.exports = router;

