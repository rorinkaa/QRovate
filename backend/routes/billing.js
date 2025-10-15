import express from 'express';
import Stripe from 'stripe';
import { resolveBaseUrl } from '../ip.js';
import { getUser, linkStripe, setPro } from '../db.js';

const router = express.Router();
const stripeKey = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeKey ? new Stripe(stripeKey) : null;

// Create a Checkout session for subscription
router.post('/checkout', async (req, res) => {
  try{
    if(!stripe) return res.status(500).json({ error: 'Stripe key not configured' });
    const { email } = req.body || {};
    if(!email) return res.status(400).json({ error: 'email required' });
    const priceId = process.env.STRIPE_PRICE_ID;
    if(!priceId) return res.status(500).json({ error: 'STRIPE_PRICE_ID not set' });

    const base = resolveBaseUrl();
    const successUrl = `${base}/billing/success?email=${encodeURIComponent(email)}`;
    const cancelUrl = `${base}/billing/cancel`;

    // Ensure customer
    let customerId = null;
    const user = getUser(email);
    if(user && user.stripeCustomerId){ customerId = user.stripeCustomerId; }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: customerId ? undefined : email,
      customer: customerId || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true
    });

    return res.json({ url: session.url });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Checkout failed' });
  }
});

// Webhook to mark user as Pro on successful payment
export async function webhookHandler(req, res){
  try{
    if(!stripe) return res.status(500).send('Stripe not configured');
    const sig = req.headers['stripe-signature'];
    const whSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    let event;
    try{
      event = stripe.webhooks.constructEvent(req.body, sig, whSecret);
    }catch(err){
      console.error('Webhook signature verify failed', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if(event.type === 'checkout.session.completed' || event.type === 'invoice.payment_succeeded'){
      const data = event.data.object;
      // Extract email and subscription/customer id
      const email = data.customer_details?.email || data.customer_email;
      const customerId = data.customer || data.customer_id || null;
      const subId = data.subscription || null;
      if(email){
        linkStripe(email, customerId, subId);
        setPro(email, true);
        console.log('Upgraded user to Pro via webhook:', email);
      }
    }
    res.json({ received: true });
  }catch(e){
    console.error(e);
    res.status(500).send('Webhook handler error');
  }
}

export default router;
