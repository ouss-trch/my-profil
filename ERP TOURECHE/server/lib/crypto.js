import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

// AES-256-GCM لمفاتيح الربط (Shopify، Meta، شركات التوصيل…) المخزنة في قاعدة البيانات
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.masterKey, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(payload) {
  if (!payload) return '';
  const [ver, iv, tag, data] = String(payload).split(':');
  if (ver !== 'v1') throw new Error('unknown_cipher_version');
  const decipher = crypto.createDecipheriv('aes-256-gcm', config.masterKey, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

const BCRYPT_ROUNDS = 12;

export const hashPassword = (pw) => bcrypt.hash(String(pw), BCRYPT_ROUNDS);
export const verifyPassword = (pw, hash) => (hash ? bcrypt.compare(String(pw ?? ''), hash) : Promise.resolve(false));

/** كلمة مرور قوية بما يكفي: 8 أحرف على الأقل، وحرف ورقم */
export function passwordProblem(pw) {
  const s = String(pw ?? '');
  if (s.length < 8) return 'password_too_short';
  if (!/[0-9]/.test(s) || !/[^0-9]/.test(s)) return 'password_needs_letters_and_digits';
  return null;
}

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
