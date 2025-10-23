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
  , updateUserProfile
} from '../db.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../email.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this';
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function normalizeEmail(e){
  return (e || '').toString().trim().toLowerCase();
}

function responseUser(email) {
  const norm = normalizeEmail(email);
  const profile = getUser(norm);
  return {
    email: norm,
    is_pro: !!profile?.isPro,
    trial_days_left: trialDaysLeft(norm),
    email_verified: !!profile?.emailVerified
  };
}

function signToken(email) {
  const norm = normalizeEmail(email);
  return jwt.sign({ sub: norm }, JWT_SECRET, { expiresIn: '7d' });
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
    return normalizeEmail(decoded?.sub || null);
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
  const normEmail = normalizeEmail(email);
  if (!normEmail || !password) return res.status(400).json({ error: 'Missing fields' });
  // Skip captcha for testing - remove in production
  // if (!await ensureCaptcha(req, captchaToken)) {
  //   return res.status(400).json({ error: 'Captcha validation failed', code: 'BAD_CAPTCHA' });
  // }
  const u = getUser(normEmail);
  if (!u) return res.status(401).json({ error: 'Invalid credentials' });

  // migrate plain password if exists
  if (u.password && !u.passwordHash && u.password === password) {
    const hash = bcrypt.hashSync(password, 12);
    setPasswordHash(email, hash);
    delete u.password;
  }
  if (!u.passwordHash || !bcrypt.compareSync(password, u.passwordHash))
    return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken(normEmail);
  const needsVerification = !u.emailVerified;
  res.json({
    token,
    user: { ...responseUser(normEmail), needs_verification: needsVerification }
  });
});

router.post('/register', async (req, res) => {
  const { email, password, captchaToken, plan } = req.body || {};
  const normEmail = normalizeEmail(email);
  if (!normEmail || !password) return res.status(400).json({ error: 'Missing fields' });
  // Skip captcha for testing - remove in production
  // if (!await ensureCaptcha(req, captchaToken)) {
  //   return res.status(400).json({ error: 'Captcha validation failed', code: 'BAD_CAPTCHA' });
  // }

  const hash = bcrypt.hashSync(password, 12);
  const ok = addUser(normEmail, undefined, hash);
  if (!ok) return res.status(400).json({ error: 'User exists' });
  // By default users are free accounts. 'pro' upgrade flows are handled separately.

  const verifyToken = createVerificationToken(normEmail);
  if (verifyToken) {
    logDevLink('verify', normEmail, verifyToken);
    // Send verification email
    await sendVerificationEmail(normEmail, verifyToken, FRONTEND_URL);
  }

  res.status(201).json({
    requires_verification: true,
    user: { ...responseUser(normEmail), email_verified: false },
    dev_verification_url: process.env.NODE_ENV === 'production' ? undefined : `${FRONTEND_URL}/?verify=${verifyToken}`
  });
});

// Get my profile (requires auth)
router.get('/profile', async (req, res) => {
  const authed = authEmailFromRequest(req);
  if (!authed) return res.status(401).json({ error: 'Unauthorized' });
  const user = getUser(authed);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ email: authed, is_pro: !!user.isPro, trial_days_left: trialDaysLeft(authed), email_verified: !!user.emailVerified });
});

// Update simple profile fields (non-sensitive)
router.post('/profile', async (req, res) => {
  const authed = authEmailFromRequest(req);
  if (!authed) return res.status(401).json({ error: 'Unauthorized' });
  const { emailVerified } = req.body || {};
  const updates = {};
  if (typeof emailVerified === 'boolean') updates.emailVerified = emailVerified;
  const ok = updateUserProfile ? updateUserProfile(authed, updates) : false;
  if (!ok) return res.status(400).json({ error: 'Failed to update' });
  res.json({ ok: true });
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
  const rawTarget = email || authEmailFromRequest(req);
  const targetEmail = normalizeEmail(rawTarget);
  if (!targetEmail) return res.status(400).json({ error: 'Email required' });

  // Skip captcha for testing - remove in production
  // if (!await ensureCaptcha(req, captchaToken)) {
  //   return res.status(400).json({ error: 'Captcha validation failed', code: 'BAD_CAPTCHA' });
  // }

  const user = getUser(targetEmail);
  if (!user) return res.json({ ok: true });
  if (user.emailVerified) return res.json({ ok: true });

  const verifyToken = createVerificationToken(targetEmail);
  if (verifyToken) {
    logDevLink('verify', targetEmail, verifyToken);
    // Send verification email
    await sendVerificationEmail(targetEmail, verifyToken, FRONTEND_URL);
  }

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

router.post('/claim', async (req, res) => {
  const authed = authEmailFromRequest(req);
  if (!authed) return res.status(401).json({ error: 'Unauthorized' });
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing token' });
  try {
    const claimed = claimGuestQRs(token, authed);
    res.json({ ok: true, claimed });
  } catch (e) {
    res.status(500).json({ error: 'Failed to claim' });
  }
});

router.post('/password/forgot', async (req, res) => {
  const { email, captchaToken } = req.body || {};
  const normEmail = normalizeEmail(email);
  if (!normEmail) return res.status(400).json({ error: 'Email required' });
  // Skip captcha for testing - remove in production
  // if (!await ensureCaptcha(req, captchaToken)) {
  //   return res.status(400).json({ error: 'Captcha validation failed', code: 'BAD_CAPTCHA' });
  // }
  const user = getUser(normEmail);
  if (!user) return res.json({ ok: true });
  const token = createResetToken(normEmail);
  if (token) {
    logDevLink('reset', normEmail, token);
    // Send password reset email
    const emailSent = await sendPasswordResetEmail(normEmail, token, process.env.FRONTEND_URL || 'https://qrovate-fe.vercel.app');
    if (!emailSent && process.env.NODE_ENV === 'production') {
      console.log('PASSWORD RESET EMAIL FAILED - Manual reset link:', `${process.env.FRONTEND_URL || 'https://qrovate-fe.vercel.app'}/?reset=${token}`);
    }
  }
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
