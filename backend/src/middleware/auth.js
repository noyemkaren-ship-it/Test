import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// Конфигурация безопасности
const SALT_ROUNDS = process.env.NODE_ENV === 'production' ? 12 : 10;
const SECRET = process.env.JWT_SECRET || 'graph-platform-dev-secret-change-me';
const API_KEY = process.env.API_KEY || 'dev-api-key';
const TOKEN_EXPIRY = process.env.JWT_EXPIRY || '24h';

// Предупреждение при использовании дефолтных секретов
if (SECRET === 'graph-platform-dev-secret-change-me') {
  if (process.env.NODE_ENV === 'production') {
    console.error('🔴 FATAL: JWT_SECRET не настроен в production! Завершение работы.');
    process.exit(1);
  } else {
    console.warn('🟡 WARNING: Используется дефолтный JWT_SECRET. Установите JWT_SECRET в .env для продакшена.');
  }
}

if (API_KEY === 'dev-api-key' && process.env.NODE_ENV === 'production') {
  console.error('🔴 FATAL: API_KEY не настроен в production! Завершение работы.');
  process.exit(1);
}

/**
 * Хеширование пароля с автоматической солью
 * @param {string} password - открытый пароль
 * @returns {string} хеш bcrypt
 */
export function hashPassword(password) {
  try {
    return bcrypt.hashSync(password, SALT_ROUNDS);
  } catch (error) {
    console.error('Password hashing failed:', error.message);
    throw new Error('Failed to hash password');
  }
}

/**
 * Проверка пароля
 * @param {string} password - открытый пароль
 * @param {string} hash - хеш из БД
 * @returns {boolean} true если пароль верный
 */
export function checkPassword(password, hash) {
  try {
    // Защита от timing attacks - всегда сравниваем, даже если хеш невалидный
    if (!hash || !hash.startsWith('$2')) {
      // Поддельный хеш для предотвращения утечки информации
      bcrypt.compareSync(password, '$2b$10$abcdefghijklmnopqrstuvwxyz0123456789');
      return false;
    }
    return bcrypt.compareSync(password, hash);
  } catch (error) {
    console.error('Password check failed:', error.message);
    return false;
  }
}

/**
 * Создание JWT токена
 * @param {Object} payload - данные пользователя (id, email, workspaceId, role)
 * @returns {string} подписанный JWT токен
 */
export function signToken(payload) {
  try {
    return jwt.sign(
      {
        sub: payload.id,
        id: payload.id,
        email: payload.email,
        workspaceId: payload.workspaceId,
        role: payload.role,
        iat: Math.floor(Date.now() / 1000)
      },
      SECRET,
      { 
        expiresIn: TOKEN_EXPIRY,
        algorithm: 'HS256'
      }
    );
  } catch (error) {
    console.error('Token signing failed:', error.message);
    throw new Error('Failed to sign token');
  }
}

/**
 * Middleware: обязательная аутентификация
 */
export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  // Проверка API ключа как fallback для сервисных аккаунтов
  if (!token) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === API_KEY) {
      req.user = { id: 'api', role: 'service', workspaceId: 'ws-default' };
      return next();
    }
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    
    // Проверка срока действия
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ error: 'Token expired' });
    }
    
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('Auth error:', err.message);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * Middleware: опциональная аутентификация
 * Не требует токен, но если он есть - проверяет
 */
export function authOptional(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  if (!token) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === API_KEY) {
      req.user = { id: 'api', role: 'service', workspaceId: 'ws-default' };
      return next();
    }
    req.user = { id: 'anon', role: 'guest', workspaceId: 'ws-default' };
    return next();
  }

  try {
    const decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    req.user = decoded;
  } catch (err) {
    req.user = { id: 'anon', role: 'guest', workspaceId: 'ws-default' };
  }
  
  next();
}

/**
 * Middleware: проверка роли
 * @param {...string} roles - допустимые роли
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (roles.includes(req.user.role)) {
      return next();
    }
    
    return res.status(403).json({ 
      error: 'Insufficient permissions',
      required: roles,
      current: req.user.role
    });
  };
}

/**
 * Middleware: только админ
 */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  if (req.user.role === 'admin' || req.user.role === 'service') {
    return next();
  }
  
  // Проверка API ключа для сервисных операций
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === API_KEY) {
    return next();
  }
  
  return res.status(403).json({ error: 'Admin access required' });
}

/**
 * Утилита: извлечение ID пользователя
 */
export function getUserId(req) {
  return req.user?.sub || req.user?.id || null;
}

/**
 * Утилита: проверка isAuthenticated
 */
export function isAuthenticated(req) {
  return !!(req.user && req.user.id !== 'anon');
}

/**
 * Утилита: валидация пароля
 * @param {string} password - пароль для проверки
 * @returns {Object} результат валидации
 */
export function validatePasswordStrength(password) {
  const errors = [];
  
  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  
  if (password && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (password && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (password && !/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

export { SECRET, API_KEY, SALT_ROUNDS, TOKEN_EXPIRY };