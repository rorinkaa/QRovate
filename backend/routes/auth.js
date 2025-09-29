import express from 'express';
import { getUser, addUser, setPro, trialDaysLeft } from '../db.js';

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if(!email || !password) return res.status(400).json({ error: 'Missing fields' });
  const u = getUser(email);
  if(!u || u.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
  return res.json({ user: { email, is_pro: !!u.isPro, trial_days_left: trialDaysLeft(email) } });
});

router.post('/register', (req, res) => {
  const { email, password } = req.body || {};
  if(!email || !password) return res.status(400).json({ error: 'Missing fields' });
  const ok = addUser(email, password);
  if(!ok) return res.status(400).json({ error: 'User exists' });
  return res.json({ user: { email, is_pro: false, trial_days_left: 7 } });
});

// demo fallback (kept)
router.post('/upgrade', (req, res) => {
  const { email } = req.body || {};
  if(!email) return res.status(400).json({ error: 'email required' });
  const ok = setPro(email, true);
  if(!ok) return res.status(404).json({ error: 'User not found' });
  return res.json({ ok: true });
});

export default router;
