import express from 'express';
import Stripe from 'stripe';
import { resolveBaseUrl } from '../ip.js';
import { linkStripe, setPro } from '../db.js';

const router = express.Router();
const stripeKey = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeKey ? new Stripe(stripeKey) : null;

router.post('/checkout', async (req, res) => {
  try{
    if(!stripe) return res.status(500).json({ error: 'Stripe key not configured' });
    const { email } = req.body || {};
    if(!email) return res.status(400).json({ error: 'email required' });
    const priceId = process.env.STRIPE_PRICE_ID;
    if(!priceId) return res.status(500).json({ error: 'Price not configured' });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${resolveBaseUrl()}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${resolveBaseUrl()}/billing/cancel`,
      customer_email: email
    });
    res.json({ id: session.id, url: session.url });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Checkout error' });
  }
});

export async function webhookHandler(req, res){
  try{
    if(!stripe) return res.status(500).send('Stripe not configured');
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if(!webhookSecret) return res.status(500).send('Webhook secret missing');
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    if(event.type === 'checkout.session.completed'){
      const session = event.data.object;
      const customerId = session.customer;
      const subId = session.subscription;
      const email = session.customer_details?.email || null;
      if(email){
        linkStripe(email, customerId, subId);
        setPro(email, true);
        console.log('Upgraded user to Pro via webhook:', email);
      }
    }
    return res.json({ received: true });
  }catch(e){
    console.error('Webhook error', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }
}

export default router;
