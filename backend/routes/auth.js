import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getUser, addUser, setPro, trialDaysLeft, setPasswordHash } from '../db.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this';

function signToken(email) {
  return jwt.sign({ sub: email }, JWT_SECRET, { expiresIn: '7d' });
}

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
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
  res.json({ token, user: { email, is_pro: !!u.isPro, trial_days_left: trialDaysLeft(email) } });
});

router.post('/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  const hash = bcrypt.hashSync(password, 12);
  const ok = addUser(email, undefined, hash);
  if (!ok) return res.status(400).json({ error: 'User exists' });
  const token = signToken(email);
  res.json({ token, user: { email, is_pro: false, trial_days_left: 7 } });
});

router.post('/upgrade', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const ok = setPro(email, true);
  if (!ok) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

export default router;
