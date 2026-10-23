import {verifyStripeEvent} from '../lib/stripe-listing.mjs';
import {screeningPayment} from '../lib/screening.mjs';
import {sb} from '../lib/listings.mjs';
export const config = {api:{bodyParser:false}};
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({error:'POST required'});
  const secret = process.env.STRIPE_SCREENING_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({error:'Screening payments are not configured'});
  let event;
  try {
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk); size += buffer.length;
      if (size > 1048576) throw Error(); chunks.push(buffer);
    }
    event = verifyStripeEvent(Buffer.concat(chunks), req.headers['stripe-signature'], secret);
  } catch { return res.status(400).json({error:'Invalid Stripe signature'}); }
  try {
    const payment = screeningPayment(event, process.env.STRIPE_SCREENING_LINK_ID);
    if (payment) {
      // Unique Stripe session IDs make repeated webhook deliveries safe. Never
      // mark a screening complete or forward to an applicant-paid property URL.
      await sb('/rest/v1/rental_screening_payments?on_conflict=stripe_session_id', {
        method:'POST', body:payment, headers:{Prefer:'resolution=ignore-duplicates'}
      });
    }
    if (event.livemode === true && event.type === 'charge.refunded' && event.data?.object?.refunded === true) {
      const intent = event.data.object.payment_intent;
      if (typeof intent === 'string' && /^pi_[A-Za-z0-9_]+$/.test(intent)) {
        await sb('/rest/v1/rental_screening_payments?stripe_payment_intent_id=eq.' + encodeURIComponent(intent), {
          method:'PATCH', body:{status:'refunded'}
        });
      }
    }
    return res.json({received:true});
  } catch { return res.status(503).json({error:'Payment recording unavailable; Stripe should retry'}); }
}
