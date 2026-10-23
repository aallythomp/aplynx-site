(async () => {
  const button = document.querySelector('#screening-pay');
  const status = document.querySelector('#checkout-status');
  try {
    const response = await fetch('/api/screening-checkout', {cache:'no-store'});
    if (!response.ok) return;
    const data = await response.json();
    if (data.ready !== true || data.amount_cents !== 7900 || data.currency !== 'usd' || !data.checkout_url) return;
    const url = new URL(data.checkout_url);
    if (url.origin !== 'https://buy.stripe.com') return;
    button.href = url.href;
    button.hidden = false;
    status.textContent = 'Confirm availability with APLYNX before paying. Pay $79 once through Stripe, then receive a business-paid Checkr invitation from our team. Do not also pay through a direct-provider application link.';
  } catch { /* Keep checkout closed if configuration cannot be verified. */ }
})();
