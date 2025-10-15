import express from 'express';
import QRCode from 'qrcode';
import jwt from 'jsonwebtoken';
import { resolveBaseUrl } from '../ip.js';
import { listQR, createQR, updateQR, getQR, recordScan, trialActive } from '../db.js';

const router = express.Router();
const BASE = resolveBaseUrl();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this';

function ensureAuth(req, res, next){
  const hdr = req.headers.authorization || '';
  const parts = hdr.split(' ');
  const token = parts.length === 2 ? parts[1] : null;
  try{
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { email: payload.sub };
    return next();
  }catch(_){
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

router.get('/list', ensureAuth, (req, res) => {
  return res.json(listQR(req.user.email));
});

router.post('/create', ensureAuth, (req, res) => {
  const { target } = req.body || {};
  try{
    const item = createQR(req.user.email, target);
    return res.json(item);
  }catch(e){ return res.status(400).json({ error: e.message }); }
});

router.post('/update', ensureAuth, (req, res) => {
  const { id, target } = req.body || {};
  if(!id || !target) return res.status(400).json({ error: 'id, target required' });
  const updated = updateQR(id, req.user.email, target);
  if(updated === null) return res.status(404).json({ error: 'QR not found' });
  if(updated === false) return res.status(403).json({ error: 'Not allowed' });
  return res.json(updated);
});

// Public redirect for scans
router.get('/:id', (req, res) => {
  const id = req.params.id;
  const qr = getQR(id);
  if(!qr) return res.status(404).send('Not found');
  const target = qr.target;
  const valid = /^https?:\/\//i.test(target);
  recordScan(id, valid);
  if(valid){ return res.redirect(target); }
  return res.status(400).send('Invalid target');
});

router.get('/svg/:id', async (req, res) => {
  const id = req.params.id;
  const qr = getQR(id);
  if(!qr) return res.status(404).send('Not found');
  try{
    const link = `${BASE}/qr/${id}`;
    const svg = await QRCode.toString(link, { type: 'svg', errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'image/svg+xml'); res.send(svg);
  }catch(e){ res.status(500).send('Error generating QR SVG'); }
});

export default router;
