import jwt from 'jsonwebtoken';
import express from 'express';
import QRCode from 'qrcode';
import { resolveBaseUrl } from '../ip.js';
import {
  createQR,
  createGuestQR,
  updateQR,
  getQR,
  listQR,
  recordScan,
  getEvents
  , deleteQR
  , listStaticDesigns
  , createStaticDesign
  , deleteStaticDesign
} from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this';
const router = express.Router();

// Simple in-memory rate limiter for guest creation: 5 per hour per IP
const GUEST_LIMIT_WINDOW_MS = 1000 * 60 * 60; // 1 hour
const GUEST_LIMIT_MAX = 5;
const guestRateMap = new Map(); // ip -> [timestamps]

function checkGuestRate(ip){
  try{
    const now = Date.now();
    const arr = guestRateMap.get(ip) || [];
    // keep only timestamps within window
    const pruned = arr.filter(ts => ts > now - GUEST_LIMIT_WINDOW_MS);
    if (pruned.length >= GUEST_LIMIT_MAX) return false;
    pruned.push(now);
    guestRateMap.set(ip, pruned);
    return true;
  }catch(e){ return false; }
}

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
    let { target, style, name } = req.body || {};
    if (typeof target !== 'string') target = '';
    // normalize plain domains for URL use-cases
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(target)) {
      target = normalizeUrl(target);
    }
    const safeStyle = sanitizeStyle(style);
    const item = createQR(req.user.email, target, safeStyle, typeof name === 'string' && name.trim() ? name.trim() : 'Untitled QR');
    console.info(`[qr:create] owner=${req.user.email} id=${item.id}`);
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: 'Failed to create' });
  }
});

/** Create a guest QR (no auth required) - returns claim token */
router.post('/create-guest', (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!checkGuestRate(ip)) return res.status(429).json({ error: 'Rate limit exceeded' });
    let { target, style, name } = req.body || {};
    if (typeof target !== 'string') target = '';
    // normalize plain domains for URL use-cases
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(target)) {
      target = normalizeUrl(target);
    }
    const safeStyle = sanitizeStyle(style);
    const item = createGuestQR(target, safeStyle, typeof name === 'string' && name.trim() ? name.trim() : 'Untitled QR');
    console.info(`[qr:create-guest] id=${item.id}`);
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: 'Failed to create guest QR' });
  }
});

/** Auth: generate SVG for instant generator */
router.post('/instant-svg', ensureAuth, async (req, res) => {
  try {
    let { text, size = 256, foreground = '#000000', background = '#ffffff' } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Text is required' });
    }
    size = Math.max(128, Math.min(1024, Number(size) || 256));
    const svg = await QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 1,
      color: { dark: foreground || '#000', light: background || '#fff' },
      width: size
    });
    res.json({ svg });
  } catch (e) {
    res.status(500).json({ error: 'Failed to render SVG' });
  }
});

/** Update the target for an existing id */
router.post('/update', ensureAuth, (req, res) => {
  try {
    let { id, target, style, name } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    if (typeof target !== 'string') target = '';
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(target)) {
      target = normalizeUrl(target);
    }
    const safeStyle = sanitizeStyle(style);
    const updated = updateQR(id, req.user.email, target, safeStyle, name);
    if (updated) console.info(`[qr:update] owner=${req.user.email} id=${id}`);
    if (!updated) return res.status(404).json({ error: 'QR not found' });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

/** Delete a QR (auth) */
router.post('/delete', ensureAuth, (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const ok = deleteQR(id, req.user.email);
    if (!ok) return res.status(404).json({ error: 'QR not found or not owned' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

/** Static designs: list/create/delete (per-user) */
router.get('/static/list', ensureAuth, (req, res) => {
  try {
    const rows = listStaticDesigns(req.user.email);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to list static designs' });
  }
});

router.post('/static/create', ensureAuth, (req, res) => {
  try {
    const { name, template, values, style, payload } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const rec = createStaticDesign(req.user.email, { name, template, values, style, payload });
    res.json(rec);
  } catch (e) {
    res.status(500).json({ error: 'Failed to create static design' });
  }
});

router.post('/static/delete', ensureAuth, (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const ok = deleteStaticDesign(id, req.user.email);
    if (!ok) return res.status(404).json({ error: 'Static design not found or not owned' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete static design' });
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
