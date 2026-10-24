import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool, findUserByEmail } from './db.js';
import { audit } from './audit.js';

const scryptAsync = promisify(scrypt);
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

// Passwords are hashed with scrypt (built into Node) and a random salt,
// stored together as "salt:hash".
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = await scryptAsync(password, salt, 64);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

// Checked against when the email doesn't exist, so a wrong email takes as long
// as a wrong password and response time doesn't reveal which accounts exist.
const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

// Sessions live in Postgres, and the browser only holds a cookie with the
// session id. The cookie:
// - httpOnly: page scripts can't read it.
// - sameSite 'lax': other sites can't send requests with it.
// - rolling + maxAge: expires 15 minutes after the *last* request (idle logoff).
const PgSession = connectPgSimple(session);

export const sessions = session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: IDLE_TIMEOUT_MS,
  },
});

// Blocks every request without a logged-in user.
export function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in' });
  next();
}

// POST /api/session: log in.
export async function login(req, res) {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = await findUserByEmail(email.trim());
  const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) {
    // The attempted email is kept so repeated failures against one account
    // (or many accounts) show up in the audit log.
    await audit(req, 'login_failed', { userId: user?.id, attemptedEmail: email.trim() });
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }

  // A fresh session id on login, so an id issued before login can't be reused.
  await promisify(req.session.regenerate).call(req.session);
  req.session.user = { id: user.id, email: user.email, name: user.name };
  await audit(req, 'login');
  res.json(req.session.user);
}

// DELETE /api/session: log out.
export async function logout(req, res) {
  if (req.session.user) await audit(req, 'logout');
  await promisify(req.session.destroy).call(req.session);
  res.clearCookie('connect.sid').status(204).end();
}

// GET /api/session: who is logged in (used by the front end on page load).
export function currentUser(req, res) {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in' });
  res.json(req.session.user);
}
