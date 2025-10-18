import jwt from 'jsonwebtoken';
import express from 'express';
import QRCode from 'qrcode';
import { resolveBaseUrl } from '../ip.js';
import {
  createQR,
  updateQR,
  getQR,
  listQR,
  recordScan
} from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this';
const router = express.Router();

/** Simple bearer auth for API routes */
function ensureAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const [, token] = hdr.split(' ');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { email: payload.sub };
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

/** Utilities */
function normalizeUrl(u) {
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/** List my dynamic QRs */
router.get('/list', ensureAuth, (req, res) => {
  try {
    const rows = listQR(req.user.email);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to list' });
  }
});

/** Create a dynamic QR (legacy: accepts {target}) */
router.post('/create', ensureAuth, (req, res) => {
  try {
    let { target } = req.body || {};
    if (typeof target !== 'string') target = '';
    // normalize plain domains for URL use-cases
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(target)) {
      target = normalizeUrl(target);
    }
    const item = createQR(req.user.email, target);
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: 'Failed to create' });
  }
});

/** Update the target for an existing id */
router.post('/update', ensureAuth, (req, res) => {
  try {
    let { id, target } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    if (typeof target !== 'string') target = '';
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(target)) {
      target = normalizeUrl(target);
    }
    const updated = updateQR(id, req.user.email, target);
    if (!updated) return res.status(404).json({ error: 'QR not found' });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

/** Stats for one QR (auth) */
router.get('/stats/:id', ensureAuth, (req, res) => {
  const qr = getQR(req.params.id);
  if (!qr || qr.owner !== req.user.email) return res.status(404).json({ error: 'QR not found' });
  res.json({
    id: req.params.id,
    scanCount: qr.scanCount || 0,
    blockedCount: qr.blockedCount || 0,
    lastScanAt: qr.lastScanAt || null,
    createdAt: qr.createdAt || null
  });
});

/** Public: redirect by id (counts scans) */
router.get('/:id', (req, res) => {
  const id = req.params.id;
  const qr = getQR(id);
  if (!qr) return res.status(404).send('QR not found');
  const target = qr.target || '';
  // allow http(s), mailto:, tel:, sms:, facetime:, upi:, etc. If empty, 404.
  if (!target) {
    recordScan(id, false);
    return res.status(404).send('No target configured for this QR.');
  }
  // Count and redirect
  recordScan(id, true);
  res.redirect(target);
});

/** Public: SVG image that encodes the /qr/:id URL (good for embedding in FE) */
router.get('/svg/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const base = resolveBaseUrl();
    const url = `${base.replace(/\/$/, '')}/qr/${id}`;
    const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'H', margin: 1, width: 256 });
    // Helpful headers for cross-origin <img>
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=600'); // 10 min
    res.type('image/svg+xml').send(svg);
  } catch (e) {
    res.status(500).send('Failed to generate SVG');
  }
});

export default router;
