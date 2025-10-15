import express from 'express';
import QRCode from 'qrcode';
import { resolveBaseUrl } from '../ip.js';
import { listQR, createQR, updateQR, getQR, recordScan, trialActive, getUser } from '../db.js';

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

  const ownerUser = getUser(qr.owner);
  const allowed = trialActive(qr.owner);

  if(!allowed){
    recordScan(id, false);
    return res.redirect(302, `${BASE}/paywall/${id}`);
  }

  // Non-Pro but trial active -> watermark interstitial then redirect
  if(ownerUser && !ownerUser.isPro){
    recordScan(id, true);
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="1;url=${qr.target}">
<title>Redirecting…</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;background:#0b5fff;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh}
.badge{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.35);padding:10px 14px;border-radius:999px}
a{color:#fff}
</style></head>
<body>
  <div class="badge">Powered by <b>YourApp</b> — <a href="${BASE}/upgrade?email=${encodeURIComponent(qr.owner)}">Upgrade to remove</a></div>
</body></html>`;
    res.setHeader('Content-Type','text/html'); return res.send(html);
  }

  recordScan(id, true);
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
