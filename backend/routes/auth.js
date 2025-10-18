import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  getUser,
  addUser,
  setPro,
  trialDaysLeft,
  setPasswordHash,
  setEmailVerified,
  createVerificationToken,
  consumeVerificationToken,
  createResetToken,
  consumeResetToken
} from '../db.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this';
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function responseUser(email) {
  const profile = getUser(email);
  return {
    email,
    is_pro: !!profile?.isPro,
    trial_days_left: trialDaysLeft(email),
    email_verified: !!profile?.emailVerified
  };
}

function signToken(email) {
  return jwt.sign({ sub: email }, JWT_SECRET, { expiresIn: '7d' });
}

async function verifyCaptcha(token) {
  if (!RECAPTCHA_SECRET) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams();
    body.append('secret', RECAPTCHA_SECRET);
    body.append('response', token);
    const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const data = await resp.json();
    return !!data.success;
  } catch (err) {
    console.error('recaptcha verify error', err);
    return false;
  }
}

function authEmailFromRequest(req) {
  const header = req.get('authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded?.sub || null;
  } catch {
    return null;
  }
}

async function ensureCaptcha(req, token, { allowAuthBypass = false } = {}) {
  if (!RECAPTCHA_SECRET) return true;
  if (token && await verifyCaptcha(token)) return true;
  if (allowAuthBypass) {
    const authedEmail = authEmailFromRequest(req);
    if (authedEmail) return true;
  }
  return false;
}

function logDevLink(type, email, token) {
  if (process.env.NODE_ENV === 'production') return;
  const param = type === 'verify' ? 'verify' : 'reset';
  console.info(`[auth:${type}] ${FRONTEND_URL}/?${param}=${token} (${email})`);
}

router.post('/login', async (req, res) => {
  const { email, password, captchaToken } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (!await ensureCaptcha(req, captchaToken)) {
    return res.status(400).json({ error: 'Captcha validation failed', code: 'BAD_CAPTCHA' });
  }

  const u = getUser(email);
  if (!u) return res.status(401).json({ error: 'Invalid credentials' });

  // migrate plain password if exists
  if (u.password && !u.passwordHash && u.password === password) {
    const hash = bcrypt.hashSync(password, 12);
    setPasswordHash(email, hash);
    delete u.password;
  }
  if (!u.passwordHash || !bcrypt.compareSync(password, u.passwordHash))
    return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken(email);
  const needsVerification = !u.emailVerified;
  res.json({
    token,
    user: { ...responseUser(email), needs_verification: needsVerification }
  });
});

router.post('/register', async (req, res) => {
  const { email, password, captchaToken, plan } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (!await ensureCaptcha(req, captchaToken)) {
    return res.status(400).json({ error: 'Captcha validation failed', code: 'BAD_CAPTCHA' });
  }

  const hash = bcrypt.hashSync(password, 12);
  const ok = addUser(email, undefined, hash);
  if (!ok) return res.status(400).json({ error: 'User exists' });
  if (plan === 'pro') setPro(email, true);

  const verifyToken = createVerificationToken(email);
  if (verifyToken) logDevLink('verify', email, verifyToken);

  res.status(201).json({
    requires_verification: true,
    user: { ...responseUser(email), email_verified: false },
    dev_verification_url: process.env.NODE_ENV === 'production' ? undefined : `${FRONTEND_URL}/?verify=${verifyToken}`
  });
});

router.post('/upgrade', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const ok = setPro(email, true);
  if (!ok) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

router.post('/resend-verification', async (req, res) => {
  const { email, captchaToken } = req.body || {};
  const targetEmail = email || authEmailFromRequest(req);
  if (!targetEmail) return res.status(400).json({ error: 'Email required' });

  if (!await ensureCaptcha(req, captchaToken, { allowAuthBypass: true })) {
    return res.status(400).json({ error: 'Captcha validation failed', code: 'BAD_CAPTCHA' });
  }

  const user = getUser(targetEmail);
  if (!user) return res.json({ ok: true });
  if (user.emailVerified) return res.json({ ok: true });

  const verifyToken = createVerificationToken(targetEmail);
  if (verifyToken) logDevLink('verify', targetEmail, verifyToken);

  res.json({ ok: true });
});

router.post('/verify', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing token' });
  const email = consumeVerificationToken(token);
  if (!email) return res.status(400).json({ error: 'Invalid or expired token', code: 'TOKEN_INVALID' });
  setEmailVerified(email, true);
  res.json({ ok: true, email });
});

router.post('/password/forgot', async (req, res) => {
  const { email, captchaToken } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!await ensureCaptcha(req, captchaToken)) {
    return res.status(400).json({ error: 'Captcha validation failed', code: 'BAD_CAPTCHA' });
  }
  const user = getUser(email);
  if (!user) return res.json({ ok: true });
  const token = createResetToken(email);
  if (token) logDevLink('reset', email, token);
  res.json({ ok: true });
});

router.post('/password/reset', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Missing fields' });
  const email = consumeResetToken(token);
  if (!email) return res.status(400).json({ error: 'Invalid or expired token', code: 'TOKEN_INVALID' });
  const hash = bcrypt.hashSync(password, 12);
  setPasswordHash(email, hash);
  setEmailVerified(email, true);
  res.json({ ok: true });
});

export default router;
