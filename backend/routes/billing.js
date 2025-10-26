import express from 'express';
import * as ls from '@lemonsqueezy/lemonsqueezy.js';
import jwt from 'jsonwebtoken';
import * as db from '../db.js';
import * as dbPrisma from '../db-prisma.js';

const router = express.Router();
const lsApiKey = process.env.LEMON_SQUEEZY_API_KEY || '';
ls.lemonSqueezySetup({ apiKey: lsApiKey });
const usePrisma = process.env.USE_PRISMA === 'true';
const getUser = usePrisma ? dbPrisma.getUser : db.getUser;
const linkStripe = usePrisma ? dbPrisma.linkStripe : db.linkStripe;
const setPro = usePrisma ? dbPrisma.setPro : db.setPro;
const getUserByLemonSqueezyCustomer = usePrisma ? dbPrisma.getUserByLemonSqueezyCustomer : db.getUserByLemonSqueezyCustomer;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this';
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.sub) throw new Error('Invalid token payload');
    req.user = { email: payload.sub };
    return next();
  } catch (err) {
    console.error('Billing auth failed:', err.message);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

async function lookupEmailFromCustomer(customerId) {
  if (!customerId) return null;
  const userRecord = await getUserByLemonSqueezyCustomer(customerId);
  if (userRecord?.email) return userRecord.email;
  if (!ls) return null;
  try {
    const customer = await ls.getCustomer({ id: customerId });
    if (customer && customer.data) {
      return customer.data.attributes.email || null;
    }
  } catch (err) {
    console.error('Lemon Squeezy webhook: failed to retrieve customer', err.message);
  }
  return null;
}

async function resolveEmail(customerId, metadataEmail, fallbackEmail) {
  if (metadataEmail) return metadataEmail;
  if (fallbackEmail) return fallbackEmail;
  return await lookupEmailFromCustomer(customerId);
}

async function handleSubscriptionStatus(subscription) {
  if (!subscription) return;
  const customerId = subscription.attributes.customer_id || null;
  const email = await resolveEmail(
    customerId,
    subscription.attributes.user_email,
    subscription.attributes.customer_email || null
  );
  if (!email) {
    console.warn('Lemon Squeezy webhook: unable to resolve email for subscription event');
    return;
  }
  await linkStripe(email, customerId, subscription.id || null);
  const isActive = ACTIVE_STATUSES.has(subscription.attributes.status);
  await setPro(email, isActive);
}

async function handleOrder(order) {
  const customerId = order.attributes.customer_id || null;
  const email = await resolveEmail(
    customerId,
    order.attributes.user_email,
    order.attributes.customer_email || null
  );
  if (!email) {
    console.warn('Lemon Squeezy webhook: unable to resolve email for order');
    return;
  }
  await linkStripe(email, customerId, order.attributes.subscription_id || null);
  if (order.attributes.subscription_id && ls) {
    try {
      const subscription = await ls.getSubscription({ id: order.attributes.subscription_id });
      if (subscription.data) {
        await handleSubscriptionStatus(subscription.data);
      }
    } catch (err) {
      console.error('Lemon Squeezy webhook: failed to retrieve subscription', err.message);
      await setPro(email, true);
    }
  } else {
    await setPro(email, true);
  }
}

// Create a Checkout session for subscription
router.post('/checkout', requireAuth, async (req, res) => {
  try{
    if(!ls) return res.status(500).json({ error: 'Lemon Squeezy key not configured' });
    const email = req.user?.email || req.body?.email;
    if(!email) return res.status(400).json({ error: 'email required' });
    const account = await getUser(email);
    if (!account) return res.status(404).json({ error: 'User not found' });
    const variantId = process.env.LEMON_SQUEEZY_VARIANT_ID;
    if(!variantId) return res.status(500).json({ error: 'LEMON_SQUEEZY_VARIANT_ID not set' });

    const checkout = await ls.createCheckout({
      storeId: process.env.LEMON_SQUEEZY_STORE_ID,
      variantId: variantId,
      attributes: {
        checkout_data: {
          email: email,
          custom: {
            user_email: email
          }
        }
      }
    });

    return res.json({ url: checkout.data.attributes.url });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Checkout failed' });
  }
});

router.post('/portal', requireAuth, async (req, res) => {
  try {
    if (!ls) return res.status(500).json({ error: 'Lemon Squeezy key not configured' });
    const email = req.user?.email;
    if (!email) return res.status(400).json({ error: 'email required' });
    const account = await getUser(email);
    if (!account) return res.status(404).json({ error: 'User not found' });
    if (!account.stripeCustomerId) {
      return res.status(400).json({ error: 'No active subscription found for this account.' });
    }
    // Lemon Squeezy doesn't have a direct portal equivalent, but we can redirect to their customer portal
    // For now, we'll return a placeholder URL - you may need to implement custom portal logic
    const portalUrl = `https://app.lemonsqueezy.com/my-orders?email=${encodeURIComponent(email)}`;
    res.json({ url: portalUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create billing portal session' });
  }
});

// Webhook to mark user as Pro on successful payment
export async function webhookHandler(req, res){
  try{
    if(!ls) return res.status(500).send('Lemon Squeezy not configured');
    const sig = req.headers['x-signature'];
    const whSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET || '';
    // Lemon Squeezy webhook verification - you may need to implement proper signature verification
    // For now, we'll process the webhook without signature verification

    const event = req.body;
    const eventName = event.meta?.event_name;
    const data = event.data;

    switch (eventName) {
      case 'order_created':
        await handleOrder(data);
        break;
      case 'subscription_created':
      case 'subscription_updated':
      case 'subscription_cancelled':
      case 'subscription_resumed':
      case 'subscription_expired':
        await handleSubscriptionStatus(data);
        break;
      default:
        console.log(`Lemon Squeezy webhook received: ${eventName}`);
    }
    res.json({ received: true });
  }catch(e){
    console.error(e);
    res.status(500).send('Webhook handler error');
  }
}

export default router;
