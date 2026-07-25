import { createHash } from 'crypto';

/**
 * Security headers — OWASP Top 10 compliant
 */
export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' https://api.deepseek.com https://api.openai.com",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join('; '));
  
  res.setHeader('Permissions-Policy', [
    'accelerometer=()', 'camera=()', 'geolocation=()',
    'gyroscope=()', 'magnetometer=()', 'microphone=()',
    'payment=()', 'usb=()', 'interest-cohort=()'
  ].join(', '));
  
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  
  next();
}

/**
 * Rate limiter — in-memory с автоочисткой, whitelist и блокировкой
 */
const hits = new Map();
const WHITELIST = new Set(['127.0.0.1', '::1', 'localhost']);

const ENDPOINT_LIMITS = {
  '/api/auth/login': { windowMs: 60_000, max: 5 },
  '/api/auth/register': { windowMs: 3_600_000, max: 3 },
  '/api/copilot/chat': { windowMs: 60_000, max: 20 },
  '/api/admin': { windowMs: 60_000, max: 30 },
  default: { windowMs: 60_000, max: 100 }
};

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of hits.entries()) {
    if (now - bucket.start > 300_000) hits.delete(ip);
  }
}, 300_000);

export function rateLimit(customOptions = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    
    if (WHITELIST.has(ip)) return next();
    
    const matchedPath = Object.keys(ENDPOINT_LIMITS).find(p => req.path.startsWith(p));
    const { windowMs, max } = { ...(matchedPath ? ENDPOINT_LIMITS[matchedPath] : ENDPOINT_LIMITS.default), ...customOptions };
    
    const now = Date.now();
    let bucket = hits.get(ip);
    
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0, warnings: 0, blockedUntil: null };
      hits.set(ip, bucket);
    }
    
    if (bucket.blockedUntil && now < bucket.blockedUntil) {
      const retryAfter = Math.ceil((bucket.blockedUntil - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({ error: 'Too many requests', retryAfter });
    }
    
    bucket.count += 1;
    
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil((bucket.start + windowMs) / 1000));
    
    if (bucket.count > max) {
      bucket.warnings += 1;
      
      if (bucket.warnings > 3) {
        bucket.blockedUntil = now + 300_000;
        console.warn(`IP ${ip} blocked for 5 minutes`);
        return res.status(429).json({ error: 'Too many requests. IP blocked for 5 minutes.', blockedFor: 300 });
      }
      
      return res.status(429).json({ error: 'Too many requests', retryAfter: Math.ceil((bucket.start + windowMs - now) / 1000) });
    }
    
    next();
  };
}

export function createRateLimiter(options = {}) {
  const store = new Map();
  
  return (req, res, next) => {
    const key = options.keyFn ? options.keyFn(req) : (req.ip || 'unknown');
    const now = Date.now();
    const { windowMs = 60_000, max = 10, message = 'Too many requests' } = options;
    
    let bucket = store.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      store.set(key, bucket);
    }
    
    bucket.count += 1;
    
    if (bucket.count > max) {
      return res.status(429).json({ error: message, retryAfter: Math.ceil((bucket.start + windowMs - now) / 1000) });
    }
    
    next();
  };
}

/**
 * Валидация тела чата
 */
export function validateChatBody(req, res, next) {
  const { message, actorId, selectedNodeIds, role, tab } = req.body || {};
  
  if (message == null) return res.status(400).json({ error: 'Message is required' });
  if (typeof message !== 'string') return res.status(400).json({ error: 'Message must be a string' });
  
  const trimmedMessage = message.trim();
  if (trimmedMessage.length === 0) return res.status(400).json({ error: 'Message cannot be empty' });
  if (trimmedMessage.length > 8000) return res.status(400).json({ error: 'Message too long (max 8000 characters)' });
  if (/<script|javascript:|on\w+=/i.test(trimmedMessage)) return res.status(400).json({ error: 'Invalid message content' });
  
  if (actorId && typeof actorId !== 'string') return res.status(400).json({ error: 'actorId must be a string' });
  
  if (selectedNodeIds) {
    if (!Array.isArray(selectedNodeIds)) return res.status(400).json({ error: 'selectedNodeIds must be an array' });
    if (selectedNodeIds.length > 50) return res.status(400).json({ error: 'Too many selected node IDs (max 50)' });
  }
  
  if (role && typeof role !== 'string') return res.status(400).json({ error: 'role must be a string' });
  if (tab && !['asis', 'process', 'tobe', 'ai'].includes(tab)) return res.status(400).json({ error: 'Invalid tab value' });
  
  req.body.message = trimmedMessage;
  req.body.selectedNodeIds = selectedNodeIds || [];
  
  next();
}

/**
 * Валидация регистрации
 */
export function validateRegisterBody(req, res, next) {
  const { email, password, name } = req.body || {};
  
  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (!password) return res.status(400).json({ error: 'Password is required' });
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email format' });
  if (email.length > 255) return res.status(400).json({ error: 'Email too long' });
  
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (password.length > 128) return res.status(400).json({ error: 'Password too long' });
  
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  
  if (!hasUpper || !hasLower || !hasNumber) {
    return res.status(400).json({ error: 'Password must contain uppercase, lowercase letters and numbers' });
  }
  
  if (name && name.length > 100) return res.status(400).json({ error: 'Name too long' });
  
  next();
}

/**
 * Санитизация строк от XSS
 */
export function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Проверка на SQL инъекции
 */
export function detectSQLInjection(input) {
  if (typeof input !== 'string') return false;
  const patterns = [
    /(\bUNION\b.*\bSELECT\b)/i,
    /(\bDROP\b.*\bTABLE\b)/i,
    /(\bINSERT\b.*\bINTO\b)/i,
    /('.*\bOR\b.*'.*'.*')/i,
    /(;.*\bDROP\b)/i,
    /(\bEXEC\b.*\()/i
  ];
  return patterns.some(p => p.test(input));
}

/**
 * Логирование подозрительной активности
 */
export function logSuspiciousActivity(req, reason) {
  const log = {
    timestamp: new Date().toISOString(),
    ip: req.ip || req.socket.remoteAddress,
    method: req.method,
    path: req.path,
    reason,
    headers: {
      'user-agent': req.headers['user-agent'],
      'content-type': req.headers['content-type']
    }
  };
  
  if (process.env.NODE_ENV !== 'test') {
    console.warn('Suspicious activity:', JSON.stringify(log, null, 2));
  }
  
  return log;
}

/**
 * Генерация CSRF токена
 */
export function generateCSRFToken() {
  return createHash('sha256').update(Date.now().toString() + Math.random().toString()).digest('hex');
}

/**
 * Проверка Content-Type
 */
export function requireContentType(type = 'application/json') {
  return (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes(type)) {
      return res.status(415).json({ error: `Content-Type must be ${type}`, received: contentType });
    }
    next();
  };
}

/**
 * Ограничение размера тела запроса
 */
export function bodySizeLimit(maxBytes = 2 * 1024 * 1024) {
  return (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > maxBytes) {
      return res.status(413).json({ error: 'Request body too large', maxSize: `${(maxBytes / 1024 / 1024).toFixed(1)}MB` });
    }
    next();
  };
}

/**
 * Очистка данных rate limit
 */
export function clearRateLimitData() {
  hits.clear();
}

/**
 * Статистика rate limit
 */
export function getRateLimitStats() {
  const stats = { totalIPs: hits.size, blockedIPs: 0, topOffenders: [] };
  const now = Date.now();
  const offenders = [];
  
  for (const [ip, bucket] of hits.entries()) {
    if (bucket.blockedUntil && now < bucket.blockedUntil) stats.blockedIPs += 1;
    if (bucket.count > 10) offenders.push({ ip, count: bucket.count, warnings: bucket.warnings });
  }
  
  stats.topOffenders = offenders.sort((a, b) => b.count - a.count).slice(0, 10);
  return stats;
}