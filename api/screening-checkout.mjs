import {screeningCheckout, SCREENING_AMOUNT} from '../lib/screening.mjs';
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({error:'GET required'});
  const url = screeningCheckout();
  return res.json({ready:!!url, amount_cents:SCREENING_AMOUNT, currency:'usd', checkout_url:url});
}
