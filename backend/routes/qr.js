import jwt from 'jsonwebtoken';
import express from 'express';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { fileTypeFromBuffer } from 'file-type';

import { resolveBaseUrl } from '../ip.js';
import * as db from '../db.js';
import * as dbPrisma from '../db-prisma.js';
import { extractAnalyticsData, getTargetUrl } from '../utils/analytics.js';

// Use Prisma if available, fallback to old db
const usePrisma = process.env.USE_PRISMA === 'true';
const createQR = usePrisma ? dbPrisma.createQR : db.createQR;
const createGuestQR = usePrisma ? dbPrisma.createGuestQR : db.createGuestQR;
const updateQR = usePrisma ? dbPrisma.updateQR : db.updateQR;
const getQR = usePrisma ? dbPrisma.getQR : db.getQR;
const listQR = usePrisma ? dbPrisma.listQR : db.listQR;
const recordScan = usePrisma ? dbPrisma.recordScan : db.recordScan;
const getEvents = usePrisma ? dbPrisma.getEvents : db.getEvents;
const deleteQR = usePrisma ? dbPrisma.deleteQR : db.deleteQR;
const listStaticDesigns = usePrisma ? dbPrisma.listStaticDesigns : db.listStaticDesigns;
const createStaticDesign = usePrisma ? dbPrisma.createStaticDesign : db.createStaticDesign;
const deleteStaticDesign = usePrisma ? dbPrisma.deleteStaticDesign : db.deleteStaticDesign;
const countUserQRCodes = usePrisma ? dbPrisma.countUserQRCodes : db.countUserQRCodes;
const getUserRecord = usePrisma ? dbPrisma.getUser : db.getUser;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this';
const router = express.Router();

const ENABLE_PRO_UPGRADE = process.env.ENABLE_PRO_UPGRADE === 'true';
const FREE_PLAN_DYNAMIC_LIMIT = Number(process.env.FREE_PLAN_DYNAMIC_LIMIT || 1);

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
router.get('/list', ensureAuth, async (req, res) => {
  try {
    const rows = await listQR(req.user.email);
    res.json(rows);
  } catch (e) {
    console.error('Failed to list QR codes:', e);
    res.status(500).json({ error: 'Failed to list' });
  }
});

/** Create a dynamic QR (legacy: accepts {target}) */
router.post('/create', ensureAuth, async (req, res) => {
  try {
    const user = await getUserRecord(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (ENABLE_PRO_UPGRADE && !user.isPro) {
      const existingCount = await countUserQRCodes(req.user.email);
      if (existingCount >= FREE_PLAN_DYNAMIC_LIMIT) {
        return res.status(403).json({
          error: 'Free plan limit reached. Upgrade to Pro to create more dynamic QR codes.',
          code: 'PLAN_LIMIT_DYNAMIC',
          limit: FREE_PLAN_DYNAMIC_LIMIT,
          remaining: 0
        });
      }
    }

    let { target, style, name, password, expiresAt, scheduledStart, scheduledEnd, alternateTarget } = req.body || {};
    if (typeof target !== 'string') target = '';
    // normalize plain domains for URL use-cases
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(target)) {
      target = normalizeUrl(target);
    }
    const safeStyle = sanitizeStyle(style);
    
    const options = {};
    if (password) options.password = password;
    if (expiresAt) options.expiresAt = expiresAt;
    if (scheduledStart) options.scheduledStart = scheduledStart;
    if (scheduledEnd) options.scheduledEnd = scheduledEnd;
    if (alternateTarget) options.alternateTarget = alternateTarget;
    
    const item = await createQR(req.user.email, target, safeStyle, typeof name === 'string' && name.trim() ? name.trim() : 'Untitled QR', options);
    console.info(`[qr:create] owner=${req.user.email} id=${item.id}`);
    res.json(item);
  } catch (e) {
    console.error('Failed to create QR:', e);
    res.status(500).json({ error: 'Failed to create' });
  }
});

/** Bulk create QR codes (works with JSON) */
router.post('/bulk-create', ensureAuth, async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array required' });
    }
    if (items.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 items per request' });
    }

    const user = await getUserRecord(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (ENABLE_PRO_UPGRADE && !user.isPro) {
      const existingCount = await countUserQRCodes(req.user.email);
      const remaining = FREE_PLAN_DYNAMIC_LIMIT - existingCount;
      if (remaining <= 0) {
        return res.status(403).json({
          error: 'Free plan limit reached. Upgrade to Pro to create more dynamic QR codes.',
          code: 'PLAN_LIMIT_DYNAMIC',
          limit: FREE_PLAN_DYNAMIC_LIMIT,
          remaining: 0
        });
      }
      if (items.length > remaining) {
        return res.status(403).json({
          error: `Free plan can create only ${FREE_PLAN_DYNAMIC_LIMIT} dynamic QR code${FREE_PLAN_DYNAMIC_LIMIT === 1 ? '' : 's'}. You can add ${Math.max(0, remaining)} more.`,
          code: 'PLAN_LIMIT_DYNAMIC',
          limit: FREE_PLAN_DYNAMIC_LIMIT,
          remaining: Math.max(0, remaining)
        });
      }
    }
    
    const results = [];
    for (const item of items) {
      const { target, style, name } = item;
      if (!target) {
        results.push({ success: false, error: 'Target URL required' });
        continue;
      }
      
      try {
        const normalizedTarget = /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(target) ? normalizeUrl(target) : target;
        const safeStyle = sanitizeStyle(style);
        
        const created = await createQR(
          req.user.email,
          normalizedTarget,
          safeStyle,
          name || 'Untitled QR'
        );
        results.push({ success: true, ...created });
      } catch (e) {
        results.push({ success: false, error: e.message, target });
      }
    }
    
    res.json({ results });
  } catch (e) {
    console.error('Failed to bulk create QR codes:', e);
    res.status(500).json({ error: 'Failed to bulk create' });
  }
});

/** Create a guest QR (no auth required) - returns claim token */
router.post('/create-guest', async (req, res) => {
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
    const item = await createGuestQR(target, safeStyle, typeof name === 'string' && name.trim() ? name.trim() : 'Untitled QR');
    console.info(`[qr:create-guest] id=${item.id}`);
    res.json(item);
  } catch (e) {
    console.error('Failed to create guest QR:', e);
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
router.post('/update', ensureAuth, async (req, res) => {
  try {
    let { id, target, style, name, password, expiresAt, scheduledStart, scheduledEnd, alternateTarget } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    if (typeof target !== 'string') target = '';
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(target)) {
      target = normalizeUrl(target);
    }
    const safeStyle = sanitizeStyle(style);
    
    const options = {};
    if (password !== undefined) options.password = password;
    if (expiresAt !== undefined) options.expiresAt = expiresAt;
    if (scheduledStart !== undefined) options.scheduledStart = scheduledStart;
    if (scheduledEnd !== undefined) options.scheduledEnd = scheduledEnd;
    if (alternateTarget !== undefined) options.alternateTarget = alternateTarget;
    
    const updated = await updateQR(id, req.user.email, target, safeStyle, name, options);
    if (updated) console.info(`[qr:update] owner=${req.user.email} id=${id}`);
    if (!updated) return res.status(404).json({ error: 'QR not found' });
    res.json(updated);
  } catch (e) {
    console.error('Failed to update QR:', e);
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

/** Download QR code as image */
router.get('/download/:id', ensureAuth, async (req, res) => {
  try {
    const { format = 'png', size = 512 } = req.query;
    const qr = await getQR(req.params.id);
    if (!qr || qr.owner !== req.user.email) return res.status(404).json({ error: 'QR not found' });
    
    const base = resolveBaseUrl();
    const url = `${base.replace(/\/$/, '')}/qr/${qr.id}`;
    
    const validFormats = ['png', 'svg'];
    const validSize = Math.max(256, Math.min(2048, Number(size) || 512));
    
    if (!validFormats.includes(format)) {
      return res.status(400).json({ error: 'Invalid format. Use png or svg' });
    }
    
    const options = {
      type: format,
      errorCorrectionLevel: 'H',
      margin: 1,
      width: validSize,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    };
    
    if (format === 'svg') {
      const svg = await QRCode.toString(url, options);
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Disposition', `attachment; filename="qr-${qr.id}.svg"`);
      res.send(svg);
    } else {
      const buffer = await QRCode.toBuffer(url, options);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="qr-${qr.id}.png"`);
      res.send(buffer);
    }
  } catch (e) {
    console.error('Failed to generate download:', e);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

/** Search QR codes */
router.get('/search', ensureAuth, async (req, res) => {
  try {
    const { q } = req.query;
    const allCodes = await listQR(req.user.email);
    
    if (!q) {
      return res.json(allCodes);
    }
    
    const searchTerm = q.toLowerCase();
    const filtered = allCodes.filter(code => {
      return (
        code.name.toLowerCase().includes(searchTerm) ||
        code.target.toLowerCase().includes(searchTerm) ||
        code.id.toLowerCase().includes(searchTerm)
      );
    });
    
    res.json(filtered);
  } catch (e) {
    console.error('Failed to search:', e);
    res.status(500).json({ error: 'Failed to search' });
  }
});

/** Stats for one QR (auth) */
router.get('/stats/:id', ensureAuth, async (req, res) => {
  try {
    const qr = await getQR(req.params.id);
    if (!qr || qr.owner !== req.user.email) return res.status(404).json({ error: 'QR not found' });
    res.json({
      id: req.params.id,
      scanCount: qr.scanCount || 0,
      blockedCount: qr.blockedCount || 0,
      lastScanAt: qr.lastScanAt || null,
      createdAt: qr.createdAt || null,
      successRate: qr.scanCount / (qr.scanCount + qr.blockedCount || 1) * 100
    });
  } catch (e) {
    console.error('Failed to get stats:', e);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/** Activity history (auth) */
router.get('/history/:id', ensureAuth, async (req, res) => {
  try {
    const qr = await getQR(req.params.id);
    if (!qr || qr.owner !== req.user.email) return res.status(404).json({ error: 'QR not found' });
    const events = await getEvents(req.params.id);
    res.json({ events });
  } catch (e) {
    console.error('Failed to get history:', e);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

/** File upload endpoint */
router.post('/upload', ensureAuth, async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const file = req.files.file;
    const allowedTypes = ['application/pdf', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/x-wav'];
    // Check mimetype first, but also allow based on file magic if mimetype is wrong
    let isValid = allowedTypes.includes(file.mimetype);
    if (!isValid) {
      // Check file magic for WAV files that might be misreported
      const buffer = fs.readFileSync(file.tempFilePath || file.path);
      if (buffer.length >= 12 && buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WAVE') {
        isValid = true;
      }
      // Also check with file-type library for more accurate detection
      try {
        const fileType = await fileTypeFromBuffer(buffer);
        if (fileType && allowedTypes.includes(fileType.mime)) {
          isValid = true;
        }
      } catch (e) {
        // Ignore file-type errors
      }
    }
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid file type' });
    }
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return res.status(400).json({ error: 'File too large' });
    }
    // Generate unique filename
    const ext = file.name.split('.').pop();
    const filename = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${ext}`;
    const filepath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads', filename);
    console.log('File mimetype:', file.mimetype);
    console.log('File name:', file.name);
    console.log('File size:', file.size);
    // Ensure uploads directory exists
    const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    // Move file
    file.mv(filepath, async (err) => {
      if (err) {
        console.error('File upload error:', err);
        return res.status(500).json({ error: 'Failed to save file' });
      }

      const baseUrl = resolveBaseUrl();
      const url = `${baseUrl}/uploads/${filename}`;

      // Generate thumbnail for PDF (placeholder - requires ImageMagick/GraphicsMagick)
      let thumbnailUrl = null;
      if (file.mimetype === 'application/pdf') {
        // TODO: Implement PDF thumbnail generation when ImageMagick is available
        // For now, return null for thumbnailUrl
      }

      res.json({ url, thumbnailUrl, originalName: file.name });
    });
  } catch (e) {
    console.error('Upload failed:', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

/** Get QR templates (no auth) */
router.get('/templates', (req, res) => {
  const templates = [
    {
      id: 'url',
      name: 'Website URL',
      description: 'Link to any website',
      icon: '🌐',
      placeholder: 'https://example.com'
    },
    {
      id: 'text',
      name: 'Plain Text',
      description: 'Store text information',
      icon: '📄',
      placeholder: 'Enter text here'
    },
    {
      id: 'email',
      name: 'Email',
      description: 'Send email to address',
      icon: '📧',
      placeholder: 'email@example.com'
    },
    {
      id: 'phone',
      name: 'Phone Number',
      description: 'Call a phone number',
      icon: '📱',
      placeholder: '+1234567890'
    },
    {
      id: 'sms',
      name: 'SMS Message',
      description: 'Send text message',
      icon: '💬',
      placeholder: '+1234567890'
    },
    {
      id: 'wifi',
      name: 'WiFi Network',
      description: 'Connect to WiFi',
      icon: '📶',
      placeholder: 'Network name'
    }
  ];
  res.json(templates);
});

/** Public: redirect by id (counts scans) */
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const qr = await getQR(id);
    if (!qr) return res.status(404).send('QR not found');
    
    // Check for password protection
    const password = req.query.password;
    if (qr.password && password !== qr.password) {
      await recordScan(id, false, usePrisma ? extractAnalyticsData(req) : {});
      return res.status(403).send(`
        <html>
          <head><title>Protected QR Code</title></head>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h2>This QR code is password protected</h2>
            <p>Please provide the correct password to access this content.</p>
          </body>
        </html>
      `);
    }
    
    // Get target URL based on schedule and expiration
    const target = usePrisma ? getTargetUrl(qr) : (qr.target || '');
    
    // allow http(s), mailto:, tel:, sms:, facetime:, upi:, etc. If empty, 404.
    if (!target) {
      await recordScan(id, false, usePrisma ? extractAnalyticsData(req) : {});
      return res.status(404).send('No target configured for this QR.');
    }
    // Count and redirect
    await recordScan(id, true, usePrisma ? extractAnalyticsData(req) : {});
    res.redirect(target);
  } catch (e) {
    console.error('Failed to redirect QR:', e);
    res.status(500).send('Failed to redirect');
  }
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
