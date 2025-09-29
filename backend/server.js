import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import qrRoutes from './routes/qr.js';
import billingRoutes, { webhookHandler } from './routes/billing.js';
import { resolveBaseUrl } from './ip.js';
import { getQR } from './db.js';

const app = express();

// Stripe webhook must use raw body
app.post('/billing/webhook', express.raw({type:'application/json'}), webhookHandler);

// Normal JSON for the rest
app.use(cors());
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/qr', qrRoutes);
app.use('/billing', billingRoutes);

// Paywall page
app.get('/paywall/:id', (req, res) => {
  const id = req.params.id;
  const qr = getQR(id);
  const base = resolveBaseUrl();
  if(!qr) return res.status(404).send('QR not found');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upgrade to Pro</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;background:#f6f8fb;margin:0;color:#111}
.card{max-width:700px;margin:40px auto;background:#fff;border-radius:14px;padding:28px;box-shadow:0 10px 30px rgba(15,23,42,.08)}
h1{margin-top:0}.btn{display:inline-block;background:#0b5fff;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;border:1px solid #cfd7ff}
small{color:#667085}
</style></head><body>
<div class="card">
  <h1>This QR is inactive</h1>
  <p>The trial has ended. Upgrade to Pro to reactivate this code.</p>
  <form method="post" action="${base}/billing/checkout" onsubmit="event.preventDefault();fetch('${base}/billing/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'${qr.owner}'})}).then(r=>r.json()).then(d=>{ if(d.url) location.href=d.url; })">
    <button class="btn" type="submit">Upgrade with Stripe</button>
  </form>
  <small>If you believe this is an error, contact the code owner.</small>
</div></body></html>`;
  res.setHeader('Content-Type','text/html'); res.send(html);
});

// Simple upgrade landing (demo fallback)
app.get('/upgrade', (req, res) => {
  const email = req.query.email || '';
  const base = resolveBaseUrl();
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upgrade</title>
<style>body{font-family:system-ui;background:#f6f8fb;margin:0;color:#111}.card{max-width:680px;margin:40px auto;background:#fff;border-radius:14px;padding:28px;box-shadow:0 10px 30px rgba(15,23,42,.08)} .btn{display:inline-block;background:#0b5fff;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;border:1px solid #cfd7ff}</style>
</head><body>
<div class="card"><h1>Upgrade to Pro</h1>
<p>Use Stripe checkout (preferred) or demo upgrade.</p>
<form method="post" action="${base}/billing/checkout" onsubmit="event.preventDefault();fetch('${base}/billing/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'${email}'})}).then(r=>r.json()).then(d=>{ if(d.url) location.href=d.url; })">
  <button class="btn" type="submit">Upgrade with Stripe</button>
</form>
<form method="post" action="${base}/auth/upgrade" onsubmit="event.preventDefault();fetch('${base}/auth/upgrade',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'${email}'})}).then(()=>location.href='${base}')">
  <button class="btn" type="submit">Demo Upgrade</button>
</form>
<p><small>Configure STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET in Render for real payments.</small></p>
</div></body></html>`;
  res.setHeader('Content-Type','text/html'); res.send(html);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running on ${resolveBaseUrl()}`);
});
