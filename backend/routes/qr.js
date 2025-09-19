import express from 'express';
import QRCode from 'qrcode';
import { resolveBaseUrl } from '../ip.js';
import { listQR, createQR, updateQR, getQR, recordScan, trialActive } from '../db.js';

const router = express.Router();
const BASE = resolveBaseUrl();

router.get('/list', (req, res) => {
  const owner = req.query.owner;
  if(!owner) return res.status(400).json({ error: 'owner required' });
  return res.json(listQR(owner));
});

router.post('/create', (req, res) => {
  const { owner, target } = req.body || {};
  if(!owner || !target) return res.status(400).json({ error: 'owner and target required' });
  const item = createQR(owner, target);
  return res.json(item);
});

router.post('/update', (req, res) => {
  const { id, owner, target } = req.body || {};
  if(!id || !owner || !target) return res.status(400).json({ error: 'id, owner, target required' });
  const updated = updateQR(id, owner, target);
  if(updated === null) return res.status(404).json({ error: 'QR not found' });
  if(updated === false) return res.status(403).json({ error: 'Not allowed' });
  return res.json(updated);
});

router.get('/:id', (req, res) => {
  const id = req.params.id;
  const qr = getQR(id);
  if(!qr) return res.status(404).send('QR not found');
  const allowed = trialActive(qr.owner);
  recordScan(id, allowed);
  if(!allowed){
    return res.redirect(302, `${BASE}/paywall/${id}`);
  }
  return res.redirect(302, qr.target);
});

router.get('/image/:id', async (req, res) => {
  const id = req.params.id;
  const qr = getQR(id);
  if(!qr) return res.status(404).send('QR not found');
  try{
    const link = `${BASE}/qr/${id}`;
    const buf = await QRCode.toBuffer(link, { errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'image/png'); res.send(buf);
  }catch(e){ res.status(500).send('Error generating QR image'); }
});

router.get('/image/:id.svg', async (req, res) => {
  const id = req.params.id;
  const qr = getQR(id);
  if(!qr) return res.status(404).send('QR not found');
  try{
    const link = `${BASE}/qr/${id}`;
    const svg = await QRCode.toString(link, { type: 'svg', errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'image/svg+xml'); res.send(svg);
  }catch(e){ res.status(500).send('Error generating QR SVG'); }
});

router.get('/stats/:id', (req, res) => {
  const id = req.params.id;
  const qr = getQR(id);
  if(!qr) return res.status(404).json({ error: 'QR not found' });
  res.json({ scanCount: qr.scanCount||0, blockedCount: qr.blockedCount||0, lastScanAt: qr.lastScanAt||null });
});

export default router;
