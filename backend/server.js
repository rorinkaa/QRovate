import dotenv from "dotenv";
dotenv.config({ override: true });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import qrRoutes from './routes/qr.js';
import billingRoutes, { webhookHandler } from './routes/billing.js';
import { resolveBaseUrl } from './ip.js';

const app = express();

// Trust proxy for rate limiting
app.set('trust proxy', 1);

// Security middleware
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" } // <-- add this

}));

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://qrovate-fe.vercel.app';
const EXTRA_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:5174'];
const ALLOWED_ORIGINS = Array.from(new Set([FRONTEND_URL, ...EXTRA_ORIGINS]));

const corsOptions = {
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Rate limits
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use(limiter);

// Stripe webhook must use raw body (before express.json)
app.post('/billing/webhook', express.raw({ type: 'application/json' }), webhookHandler);

// Normal JSON for the rest
app.use(express.json({ limit: '200kb' }));

app.use('/auth', authLimiter, authRoutes);
app.use('/qr', qrRoutes);
app.use('/billing', billingRoutes);

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost', () => {
  console.log(`Backend running on ${resolveBaseUrl()}`);
});
