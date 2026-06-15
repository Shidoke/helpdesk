const pool = require('../config/database');

let botInstance = null;

function setBot(bot) {
  botInstance = bot;
  console.log('✅ Бот подключен к системе уведомлений');
}

async function notifyNewComment(ticketId, commentText, authorName) {
  console.log('===== УВЕДОМЛЕНИЕ О КОММЕНТАРИИ =====');
  console.log('Тикет ID:', ticketId);
  console.log('Автор комментария:', authorName);
  
  if (!botInstance) {
    console.log('Бот не подключен'); 
    return;
  }
  
  try {
    const ticket = await pool.query(
      `SELECT t.*, u.telegram_id, u.name as requester_name
       FROM tickets t
       JOIN users u ON t.requester_id = u.id
       WHERE t.id = $1`,
      [ticketId]
    );
    
    if (ticket.rows.length === 0) {
      console.log('Тикет не обнаружен!');
      return;
    }
    
    const t = ticket.rows[0];
    console.log('Заявитель:', t.requester_name, 'Telegram ID:', t.telegram_id);
    
    // Уведомление заявителя о комментарии в его тикете
    if (t.telegram_id) {
      await botInstance.sendMessage(
        t.telegram_id,
        `📩 Новый ответ в тикете #${t.ticket_number}\n\nТема: ${t.subject}\nОт: ${authorName}\nСообщение: ${commentText.substring(0, 200)}\n\n/start — открыть бота`,
        { parse_mode: 'Markdown' }
      );
      console.log('Уведомление отправлено заявителю:', t.requester_name);
    } else {
      console.log('У заявителя нет Telegram');
    }
    
    // Уведомляем исполнителя
    if (t.assignee_id) {
      const assignee = await pool.query('SELECT telegram_id, name FROM users WHERE id = $1', [t.assignee_id]);
      
      if (assignee.rows[0]?.telegram_id && assignee.rows[0].telegram_id !== t.telegram_id) {
        await botInstance.sendMessage(
          assignee.rows[0].telegram_id,
          `📩 Новый комментарий в #${t.ticket_number}\n\nТема: ${t.subject}\nОт: ${authorName}\n\n/start`,
          { parse_mode: 'Markdown' }
        );

        console.log('Уведомление отправлено исполнителю:', assignee.rows[0].name);
      }
    }
  } catch (error) {
    console.error('❌ Ошибка уведомления:', error.message);
  }
}

async function notifyNewTicket(ticketNumber, subject, requesterName) {
  console.log('Новый тикет был добавлен!');
  console.log('Тикет:', ticketNumber);
  console.log('Тема:', subject);
  console.log('От:', requesterName);
  
  if (!botInstance) {
    console.log('❌ Бот не подключен!');
    return;
  }
  console.log('✅ Бот подключен');
  
  try {
    const agents = await pool.query(
      "SELECT telegram_id, name FROM users WHERE role IN ('agent', 'admin') AND telegram_id IS NOT NULL"
    );
    
    console.log('Агентов с Telegram:', agents.rows.length);
    console.log('Агенты:', agents.rows);
    
    for (const agent of agents.rows) {
      console.log(`Пытаюсь отправить агенту: ${agent.name} (${agent.telegram_id})`);
      
      try {
        await botInstance.sendMessage(
          agent.telegram_id,
          `🆕 Новый тикет #${ticketNumber}\n\nТема: ${subject}\nОт: ${requesterName}`
        );
        console.log(`Отправлено: ${agent.name}`);
      } 
      
      catch (err) {
        console.log(`Не получилось отправить! ${agent.name}:`, err.message);
      }
    }
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
  console.log('Уведомление отправлено.');
}

async function notifyStatusChange(ticketId, newStatus) {
  if (!botInstance) {
    console.log('notifyStatusChange: бот не подключен');
    return;
  }
  
  try {
    const ticket = await pool.query(
      `SELECT t.*, u.telegram_id 
       FROM tickets t 
       JOIN users u ON t.requester_id = u.id 
       WHERE t.id = $1`,
      [ticketId]
    );
    
    if (ticket.rows[0]?.telegram_id) {
      await botInstance.sendMessage(
        ticket.rows[0].telegram_id,
        `🔄 Статус: #${ticket.rows[0].ticket_number} → ${newStatus}\n\n/start`,
        { parse_mode: 'Markdown' }
      );
      console.log(`статус-уведомление отправлено!`);
    }
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

module.exports = { setBot, notifyNewComment, notifyNewTicket, notifyStatusChange };