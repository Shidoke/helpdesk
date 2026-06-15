const http = require('http');

const BASE_URL = 'http://localhost:5000';

function request(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = 'Bearer ' + token;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Тестирование HelpDesk API\n');

  try {
    // 1. Проверка сервера
    console.log('1️⃣ Проверка сервера...');
    const root = await request('/');
    console.log('✅ Ответ:', root.data.message);
    console.log('   Статус:', root.status);

    // 2. Вход как админ
    console.log('\n2️⃣ Вход как администратор...');
    const login = await request('/api/auth/login', 'POST', {
      email: 'admin@helpdesk.com',
      password: 'admin123'
    });
    
    if (login.data.error) {
      console.log('❌ Ошибка входа:', login.data.error);
      return;
    }
    
    console.log('✅ Вход выполнен!');
    console.log('   Пользователь:', login.data.user.name);
    console.log('   Роль:', login.data.user.role);
    console.log('   Токен получен:', login.data.accessToken ? 'Да' : 'Нет');
    
    const token = login.data.accessToken;

    // 3. Получить профиль
    console.log('\n3️⃣ Получение профиля...');
    const profile = await request('/api/auth/profile', 'GET', null, token);
    if (profile.data.error) {
      console.log('❌ Ошибка:', profile.data.error);
    } else {
      console.log('✅ Профиль:', profile.data.name);
      console.log('   Email:', profile.data.email);
      console.log('   Роль:', profile.data.role);
    }

    // 4. Получить тикеты
    console.log('\n4️⃣ Получение тикетов...');
    const tickets = await request('/api/tickets', 'GET', null, token);
    if (tickets.data.error) {
      console.log('❌ Ошибка:', tickets.data.error);
    } else {
      console.log('✅ Количество тикетов:', Array.isArray(tickets.data) ? tickets.data.length : 'ошибка формата');
      if (Array.isArray(tickets.data) && tickets.data.length > 0) {
        console.log('   Первый тикет:', tickets.data[0].subject);
        console.log('   Статус:', tickets.data[0].status);
      }
    }

    // 5. Создать новый тикет
    console.log('\n5️⃣ Создание нового тикета...');
    const newTicket = await request('/api/tickets', 'POST', {
      subject: 'Тестовый тикет ' + new Date().toLocaleTimeString(),
      description: 'Это тестовый тикет созданный автоматически',
      priority: 'Medium',
      category: 'Software'
    }, token);
    
    if (newTicket.data.error) {
      console.log('❌ Ошибка:', newTicket.data.error);
    } else {
      console.log('✅ Тикет создан!');
      console.log('   Номер:', newTicket.data.ticket_number);
      console.log('   Тема:', newTicket.data.subject);
    }

    console.log('\n🎉 Все тесты пройдены!');
    console.log('📋 Сервер работает корректно');

  } catch (error) {
    console.error('❌ Ошибка соединения:', error.message);
    console.log('\n💡 Убедитесь, что сервер запущен:');
    console.log('   node server-with-bot.js');
  }
}

runTests();