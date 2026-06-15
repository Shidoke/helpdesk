const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api'); // для интеграции бота с базой
const pool = require('./config/database'); // подключение postgreSQL
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Запуск бота
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const userStates = {};

const notifications = require('./utils/notifications');
notifications.setBot(bot);

// включение роутов и сервера

const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.get('/', (req, res) => res.json({ message: 'HelpDesk API v1.0' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Сервер: http://localhost:${PORT}`));

// меню бота в телеграме (в зависимости от ролей)

function showMainMenu(chatId, userName, role) {
  const keyboard = (role === 'admin' || role === 'agent') 
    ? [['📝 Создать тикет', '📋 Мои тикеты'], ['📋 Все тикеты', '📊 Статистика'], ['👤 Профиль', '❓ Справка']]
    : [['📝 Создать тикет'], ['📋 Мои тикеты', '👤 Профиль'], ['❓ Справка']];
  
  bot.sendMessage(chatId, `👋 ${userName} (${role})`, { reply_markup: { keyboard, resize_keyboard: true } });
}

// включаем написав /start

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const user = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);

  // в случае если вы не привязали email, он вас попросит это сделать

  if (user.rows.length > 0) {
    showMainMenu(chatId, user.rows[0].name, user.rows[0].role);
  } else 
    {
    bot.sendMessage(chatId, 'Введите ваш Email:', { reply_markup: { remove_keyboard: true } });
    userStates[chatId] = { step: 'waiting_email' };
  }
});
// создание тикета независимо от роли

bot.onText(/📝 Создать тикет/, (msg) => {
  bot.sendMessage(msg.chat.id, '📝 Введите тему:', { reply_markup: { remove_keyboard: true } });
  userStates[msg.chat.id] = { step: 'ticket_subject' };
});

// 📋 Мои тикеты (с кнопками ответа)

bot.onText(/📋 Мои тикеты/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const user = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  if (user.rows.length === 0) { bot.sendMessage(chatId, '/start'); return; }
  
  const tickets = await pool.query
  (
    // максимум 10 тикетов отобразит с фильтром на самые недавно-созданные 
    'SELECT * FROM tickets WHERE requester_id = $1 ORDER BY created_at DESC LIMIT 10', 
    [user.rows[0].id]
  );

  // Если тикетов нет, показывается сообщение и меню
  
  if (tickets.rows.length === 0) {
    bot.sendMessage(chatId, '📭 Нет тикетов.');
    showMainMenu(chatId, user.rows[0].name, user.rows[0].role);
    return;
  }
  // отображение тикета с возможностью к комментариям и ответам
  
  for (const t of tickets.rows) {
    const e = t.status === 'Open' ? '🔴' : t.status === 'Pending' ? '🟡' : t.status === 'Resolved' ? '🟢' : '⚫';
    await bot.sendMessage(chatId,
      `${e} *${t.ticket_number}* — ${t.subject}\nСтатус: ${t.status} | Приоритет: ${t.priority}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Комментарии', callback_data: `comments_${t.id}` }],
            [{ text: '✏️ Ответить', callback_data: `reply_${t.id}` }]
          ]
        }
      }
    );
  }
  showMainMenu(chatId, user.rows[0].name, user.rows[0].role);
});

// Отображение "Все тикеты" будучи администратором или агентом

bot.onText(/📋 Все тикеты/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const user = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);

  // Проверяем что пользователь агент или админ

  if (user.rows.length === 0 || (user.rows[0].role !== 'agent' && user.rows[0].role !== 'admin')) {
    bot.sendMessage(chatId, 'Извините, недостаточно прав.'); return;
  }

  // Получаем последние 10 тикетов с именами авторов

  const tickets = await pool.query(
    'SELECT t.*, u.name as requester_name FROM tickets t JOIN users u ON t.requester_id = u.id ORDER BY t.created_at DESC LIMIT 10'
  );
   
  // после получение, на всех тикетах будет висеть Ответит или сменить статус

  for (const t of tickets.rows) {
    await bot.sendMessage(chatId,
      `🔴 *${t.ticket_number}* — ${t.subject}\nОт: ${t.requester_name} | Статус: ${t.status}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Ответить', callback_data: `reply_${t.id}` }],
            [{ text: '🔄 Сменить статус', callback_data: `status_${t.id}` }] 
          ]
        }
      }
    );
  }
});

// Статистика
bot.onText(/📊 Статистика/, async (msg) => {
  const s = (await pool.query('SELECT COUNT(*) as t, COUNT(*) FILTER (WHERE status=\'Open\') as o, COUNT(*) FILTER (WHERE status=\'Pending\') as p, COUNT(*) FILTER (WHERE status=\'Resolved\') as r FROM tickets')).rows[0];
  bot.sendMessage(msg.chat.id, `📊 Статистика\n\n🔴 Открыто: ${s.o}\n🟡 В ожидании: ${s.p}\n🟢 Решено: ${s.r}\n📌 Всего: ${s.t}`, { parse_mode: 'Markdown' });
});

// Профиль
bot.onText(/👤 Профиль/, async (msg) => {
  const u = (await pool.query('SELECT * FROM users WHERE telegram_id = $1', [msg.from.id])).rows[0];
  if (u) bot.sendMessage(msg.chat.id, `👤 ${u.name}\nEmail: ${u.email}\nРоль: ${u.role}\nОтдел: ${u.department||'—'}`, { parse_mode: 'Markdown' });
});

// Справка
bot.onText(/❓ Справка/, (msg) => {
  bot.sendMessage(msg.chat.id, '🤖 *Справка*\n\n/start — меню\n📝 Создать тикет\n📋 Мои тикеты\n📋 Все тикеты\n💬 Кнопки под тикетом — ответить\n🔄 Кнопка — сменить статус', { parse_mode: 'Markdown' });
});

// поведение кнопок на их нажатие
bot.on('callback_query', async (cb) => {
  const chatId = cb.message.chat.id;
  const data = cb.data;
  
  try {
    // ответ на нажатия кнопки комментария
    if (data.startsWith('comments_')) {
      const ticketId = data.split('_')[1];
      const ticket = (await pool.query('SELECT t.*, u.name as rname FROM tickets t JOIN users u ON t.requester_id=u.id WHERE t.id=$1', [ticketId])).rows[0];
      const comments = await pool.query('SELECT c.*, u.name as aname FROM comments c JOIN users u ON c.user_id=u.id WHERE c.ticket_id=$1 ORDER BY c.created_at ASC', [ticketId]);
      
      // в случае если их нету, то пишет Нет комментариев!
      let msg = `📋 *${ticket.ticket_number}* — ${ticket.subject}\n\n`;
     
      if (comments.rows.length === 0) msg += 'Нет комментариев!';
      else comments.rows.forEach(c => msg += `*${c.aname}*: ${c.text}\n_${new Date(c.created_at).toLocaleString('ru-RU')}_\n\n`);
     
      // если оно же отобразилось, вы можете ответить на комментарий
     
      bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✏️ Ответить', callback_data: `reply_${ticketId}` }]] } });
      bot.answerCallbackQuery(cb.id);
    }
    
    // Ответ на тикет
    else if (data.startsWith('reply_')) {
      const ticketId = data.split('_')[1];
      userStates[chatId] = { step: 'adding_comment', ticketId };
      
      bot.sendMessage(chatId, '✏️ Введите ваш ответ:');
      bot.answerCallbackQuery(cb.id);
    }
    
    // в зависимости от того какой именно статус вы делаете, лишь агенты и админы могут это делать без ограничений
    else if (data.startsWith('status_')) {
      const ticketId = data.split('_')[1];
      
      bot.sendMessage(chatId, 'Выберите новый статус:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔴 Открыт', callback_data: `set_${ticketId}_Open` }, { text: '🟡 В ожидании', callback_data: `set_${ticketId}_Pending` }],
            [{ text: '🟢 Решен', callback_data: `set_${ticketId}_Resolved` }, { text: '⚫ Закрыт', callback_data: `set_${ticketId}_Closed` }]
          ]
        }
      });
      bot.answerCallbackQuery(cb.id);
    }
    
    //  Установка статуса
    else if (data.startsWith('set_')) { 
      const [, ticketId, status] = data.split('_'); 
      await pool.query('UPDATE tickets SET status=$1 WHERE id=$2', [status, ticketId]);
      bot.sendMessage(chatId, `Статус: ${status}`); // Уведомление об успешной смене статуса
      bot.answerCallbackQuery(cb.id, { text: 'Готово!' });
    }
  } catch (error) {
    console.error('Callback error:', error);
    bot.answerCallbackQuery(cb.id, { text: 'Ошибка' });
  }
});

// 
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const telegramId = msg.from.id;

  if (!text || text.startsWith('/') || ['📝 Создать тикет','📋 Мои тикеты','📋 Все тикеты','📊 Статистика','👤 Профиль','❓ Справка'].includes(text)) return;

  // проверка в зависимости от шага, на котором находится пользователь   

  const state = userStates[chatId];
  if (!state) return;

  try 
  {
    if (state.step === 'waiting_email') { // если пользователь вводит email для привязки к телеграму, то проверяет его в базе данных и сохраняет telegram_id
      const user = await pool.query('SELECT * FROM users WHERE email = $1', [text.trim().toLowerCase()]); 
      
      if (user.rows.length === 0) { bot.sendMessage(chatId, ' Не найден.'); return; } // если email не найден в базе данных, то пишется в логах
      await pool.query('UPDATE users SET telegram_id = $1 WHERE id = $2', [telegramId, user.rows[0].id]);
      delete userStates[chatId];

      
      bot.sendMessage(chatId, `Привязан! ${user.rows[0].name}`);
      showMainMenu(chatId, user.rows[0].name, user.rows[0].role);
    }

    else if (state.step === 'ticket_subject') { // создание темы тикета (заявки)
      userStates[chatId] = { step: 'ticket_priority', subject: text };
      bot.sendMessage(chatId, '⚠️ Приоритет:', { reply_markup: { keyboard: [['🟢 Низкий','🟡 Средний'],['🔴 Высокий','⛔ Критичный']], resize_keyboard: true, one_time_keyboard: true } });
    }

    else if (state.step === 'ticket_priority') { // создание приоритета тикета
      const map = { '🟢 Низкий':'Low','🟡 Средний':'Medium','🔴 Высокий':'High','⛔ Критичный':'Critical' };
      userStates[chatId] = { step: 'ticket_description', subject: state.subject, priority: map[text]||'Medium' };
      bot.sendMessage(chatId, '📝 Опишите:', { reply_markup: { remove_keyboard: true } });
    } 


    else if (state.step === 'ticket_description') {
  const user = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
  const tn = 'T-' + Date.now().toString().slice(-6);
  const p = state.priority || 'Medium';
 
  await pool.query('INSERT INTO tickets (ticket_number, subject, description, priority, requester_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [tn, state.subject, text, p, user.rows[0].id, user.rows[0].id]);
  delete userStates[chatId];

  // Время реакции и решения в часах в зависимости от приоритета

  const times = { Critical:{r:1,s:4}, High:{r:2,s:8}, Medium:{r:4,s:24}, Low:{r:8,s:48} };
  const t = times[p];
  const now = new Date();

  // Уведомление от телеграм-бота с примерным временем

  bot.sendMessage(chatId, `✅ Заявка #${tn}\n📝 ${state.subject}\n⚠️ ${p}\n⏱ Реакция: ${new Date(now.getTime()+t.r*3600000).toLocaleString('ru-RU')}\n🕐 Решение: ${new Date(now.getTime()+t.s*3600000).toLocaleString('ru-RU')}`, { parse_mode: 'Markdown' });
  
  // Уведомление агентам

  try {
    const agents = await pool.query("SELECT telegram_id FROM users WHERE role IN ('agent', 'admin') AND telegram_id IS NOT NULL");
    
    for (const a of agents.rows) {
      bot.sendMessage(a.telegram_id, `🆕 Новый тикет #${tn}\nТема: ${state.subject}\nОт: ${user.rows[0].name}`).catch(() => {});
    }
  } catch(e) {}
  // Обновляем меню

  const u = await pool.query('SELECT * FROM users WHERE id = $1', [user.rows[0].id]);
  showMainMenu(chatId, u.rows[0].name, u.rows[0].role);
}
    // Создание комментариев будучи в 
    else if (state.step === 'adding_comment') {
      const ticketId = state.ticketId;
      const user = await pool.query('SELECT id, role FROM users WHERE telegram_id = $1', [telegramId]);
      
      if (user.rows.length === 0) { bot.sendMessage(chatId, ' /start'); delete userStates[chatId]; return; }
      
      await pool.query('INSERT INTO comments (ticket_id, user_id, text) VALUES ($1,$2,$3)', [ticketId, user.rows[0].id, text]);
      
      // Если отвечает агент или администратор — меняем статус на "В ожидании"

      if (user.rows[0].role === 'agent' || user.rows[0].role === 'admin') {
        const ticket = await pool.query('SELECT status FROM tickets WHERE id=$1', [ticketId]);
        if (ticket.rows[0].status === 'Open') {
          await pool.query('UPDATE tickets SET status=\'Pending\' WHERE id=$1', [ticketId]);
        }
      }
      
      delete userStates[chatId];
      bot.sendMessage(chatId, ' Ответ отправлен!');
      
      // Уведомление
      const author = await pool.query('SELECT name FROM users WHERE id=$1', [user.rows[0].id]);
      notifications.notifyNewComment(ticketId, text, author.rows[0].name).catch(console.error);
      
      // Обновляем меню
      const u = await pool.query('SELECT * FROM users WHERE id=$1', [user.rows[0].id]);
      showMainMenu(chatId, u.rows[0].name, u.rows[0].role);
    }
  } catch (error) { console.error(error); bot.sendMessage(chatId, ' Ошибка'); delete userStates[chatId]; }
});

console.log(' Бот готов!');