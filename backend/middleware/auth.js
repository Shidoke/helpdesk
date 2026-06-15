var jwt = require('jsonwebtoken');
require('dotenv').config();

/* использует токен от JWT */
var JWT_SECRET = process.env.JWT_SECRET || 'helpdesk-secret-2024';
var JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'helpdesk-refresh-2024';

function authenticateToken(req, res, next) {
  var authHeader = req.headers['authorization'];
  var token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  jwt.verify(token, JWT_SECRET, function(err, user) {
    if (err) {
      return res.status(403).json({ error: 'Токен недействителен' });
      /* в этом случае убедитесь что jwt вообще работает, он обычно этого не допускает*/
    }
    req.user = user;
    next();
  });
}
// Проверка роли пользователя для доступа к меню
function authorizeRole (...allowedRoles) {
  return (req, res, next) => {

     const userRole = req.user.role; /*обозначим его чтобы меньше писать*/ 

    if (!allowedRoles.includes(userRole)) {
 
      console.warn(
        `Access denied for user ${req.user.id}`
      );

      return res.status(403).json({
        message: 'Недостаточно прав'
      });
    }

    next();
  };
}




function generateTokens(user) {
  /* создание accesstoken для входа */
  /* основное его назначение это использование для входа в систему, чтобы потом через час он самоуничтожился */
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
/* refreshtoken же самоунчитожится через 7 дней */
  const refreshToken = jwt.sign(
    { id: user.id },
    JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
}
module.exports = {
  authenticateToken,
  authorizeRole,
  generateTokens,
  JWT_SECRET,
  JWT_REFRESH_SECRET
};

