import jwt from 'jsonwebtoken';
import express from 'express';
import QRCode from 'qrcode';
import { resolveBaseUrl } from '../ip.js';
import {
  createQR,
  updateQR,
  getQR,
  listQR,
  recordScan,
  getEvents
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

function sanitizeStyle(style) {
  if (!style || typeof style !== 'object') return null;
  const allowedSchema = {
    size: 'number',
    colorMode: 'string',
    foreground: 'string',
    foregroundSecondary: 'string',
    gradientAngle: 'number',
    background: 'string',
    frameStyle: 'string',
    frameColor: 'string',
    frameText: 'string',
    frameTextColor: 'string',
    logoSizeRatio: 'number',
    logoDataUrl: 'string'
  };
  const result = {};
  for (const [key, type] of Object.entries(allowedSchema)) {
    if (!(key in style)) continue;
    const value = style[key];
    if (type === 'string' && typeof value === 'string') {
      result[key] = key === 'logoDataUrl' ? value.slice(0, 200000) : value.slice(0, 256);
    } else if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) {
      result[key] = value;
    }
  }
  return Object.keys(result).length ? result : null;
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
    let { target, style } = req.body || {};
    if (typeof target !== 'string') target = '';
    // normalize plain domains for URL use-cases
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(target)) {
      target = normalizeUrl(target);
    }
    const safeStyle = sanitizeStyle(style);
    const item = createQR(req.user.email, target, safeStyle);
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: 'Failed to create' });
  }
});

/** Update the target for an existing id */
router.post('/update', ensureAuth, (req, res) => {
  try {
    let { id, target, style } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    if (typeof target !== 'string') target = '';
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(target)) {
      target = normalizeUrl(target);
    }
    const safeStyle = sanitizeStyle(style);
    const updated = updateQR(id, req.user.email, target, safeStyle);
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

/** Activity history (auth) */
router.get('/history/:id', ensureAuth, (req, res) => {
  const qr = getQR(req.params.id);
  if (!qr || qr.owner !== req.user.email) return res.status(404).json({ error: 'QR not found' });
  const events = getEvents(req.params.id);
  res.json({ events });
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
