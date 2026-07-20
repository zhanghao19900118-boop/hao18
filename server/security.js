import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { config } from './config.js';

export const SESSION_COOKIE = 'dg_session';
export const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const hashPassword = password => bcrypt.hashSync(password, 12);
export const verifyPassword = (password, hash) => bcrypt.compareSync(password, hash);

export function publicUser(row) {
  return row && { id: row.id, userCode: row.user_code, username: row.username, displayName: row.display_name, role: row.role, status: row.status, mutedUntil: row.muted_until, mustChangePassword: Boolean(row.must_change_password) };
}

export function createSession(userId) {
  const token = newToken(), csrf = newToken();
  const expires = new Date(Date.now() + config.sessionDays * 86400000).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
  db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)').run(hashToken(token), csrf, userId, expires);
  return { token, csrf, expires };
}

export function auth(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const row = db.prepare(`SELECT u.*,s.csrf_token,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'`).get(hashToken(token), new Date().toISOString());
  if (row) { req.user = row; req.csrfToken = row.csrf_token; }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

export function requireCsrf(req, res, next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  if (req.path === '/auth/login') return next();
  if (!req.user) return next();
  if (!req.csrfToken || req.get('x-csrf-token') !== req.csrfToken) return res.status(403).json({ error: '请求验证失败，请刷新页面后重试' });
  next();
}

export function cookieOptions() {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/', maxAge: config.sessionDays * 86400000 };
}

export function validPassword(value) {
  return typeof value === 'string' && value.length >= 10 && value.length <= 128 && /[A-Za-z]/.test(value) && /\d/.test(value);
}
