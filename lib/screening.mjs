export const SCREENING_AMOUNT = 7900;
export const SCREENING_PROPERTY = 'ruby-court-room-3';
export function screeningCheckout(env = process.env) {
  const url = env.STRIPE_SCREENING_PAYMENT_URL;
  if (env.SCREENING_PAYMENTS_READY !== 'true' || env.CHECKR_BUSINESS_PAID_VERIFIED !== 'true' ||
      !env.STRIPE_SCREENING_WEBHOOK_SECRET || !env.STRIPE_SCREENING_LINK_ID || !url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://buy.stripe.com' || parsed.username || parsed.password || parsed.pathname.startsWith('/test_')) return null;
    return parsed.href;
  } catch { return null; }
}
export function screeningPayment(event, linkId) {
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return null;
  const x = event.data?.object;
  if (!linkId || event.livemode !== true || x?.livemode !== true || x.payment_status !== 'paid' ||
      x.mode !== 'payment' || x.currency !== 'usd' || x.amount_total !== SCREENING_AMOUNT ||
      x.payment_link !== linkId || x.metadata?.aplynx_service !== 'rental_screening' ||
      x.metadata?.property_code !== SCREENING_PROPERTY ||
      !/^cs_[A-Za-z0-9_]+$/.test(x.id || '') || !/^pi_[A-Za-z0-9_]+$/.test(x.payment_intent || '')) return null;
  const email = x.customer_details?.email;
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('Paid screening needs applicant contact review');
  return {
    stripe_session_id: x.id, stripe_payment_intent_id: x.payment_intent,
    applicant_email: email, applicant_name: String(x.customer_details?.name || '').slice(0, 150),
    property_code: SCREENING_PROPERTY, amount_cents: SCREENING_AMOUNT,
    paid_at: new Date(event.created * 1000).toISOString(), status: 'awaiting_screening_invitation'
  };
}
