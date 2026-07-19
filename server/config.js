import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  dbPath: process.env.DB_PATH || path.join(ROOT, 'worldcup-v3.db'),
  cookieSecure: process.env.COOKIE_SECURE !== 'false',
  trustProxy: Number(process.env.TRUST_PROXY || 1),
  sessionDays: Math.max(1, Number(process.env.SESSION_DAYS || 7)),
  isTest: process.env.NODE_ENV === 'test'
};
