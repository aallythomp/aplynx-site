# APLYNX $79 application and screening setup

Prepared October 22, 2026. Checkout must remain closed until end-to-end testing.

The fee is $79 per adult, including application processing and business-paid
Checkr screening. Do not redirect a paid applicant to the property's public
Checkr application URL: Checkr confirms property links always charge applicants.
Official references: https://tenant.checkr.com/resources/faq and
https://tenant.checkr.com/developers .

## Prepared implementation

- Public checkout status fails closed; no applicant payment is possible without
  explicit configuration and verification flags.
- Stripe webhook verifies signed raw events, live mode, payment status, exact
  $79 USD amount, screening service metadata, property, and payment-link ID.
- Private ledger uses unique Stripe session and payment-intent identifiers so
  duplicate deliveries do not create multiple jobs. Full refunds update status.
- Paid records enter `awaiting_screening_invitation`. This implementation does
  **not** automatically order a Checkr report. APLYNX must verify the payment,
  order business-paid screening and send a secure invitation from Checkr.
- No screening decisions, SSNs, credit reports or identity documents are stored.

## Remaining configuration

1. Verify Checkr account access and business-paid billing. For full automation,
   obtain approved live API access and integrate order creation separately.
2. Apply `db/screening-schema.sql` and verify RLS and service-role access.
3. Create live Stripe product/price for $79 and payment link (one-time, one
   applicant, no adjustable quantity). Collect applicant name and email. Set
   metadata `aplynx_service=rental_screening` and
   `property_code=ruby-court-room-3`. Do not add tax or additional fees.
4. Configure Stripe webhook for checkout.session.completed,
   checkout.session.async_payment_succeeded and charge.refunded at
   https://www.aplynxinvestments.com/api/stripe-screening-webhook . Store the
   signing secret server-side as STRIPE_SCREENING_WEBHOOK_SECRET.
5. Store STRIPE_SCREENING_PAYMENT_URL and STRIPE_SCREENING_LINK_ID server-side.
6. Test signed/invalid events, delayed payment, duplicate delivery, refund,
   ledger access restrictions, and a business-paid screening invitation.
7. Only after verification set CHECKR_BUSINESS_PAID_VERIFIED=true and
   SCREENING_PAYMENTS_READY=true, activate the Stripe product/link, and deploy.

## Blockers observed

- No Stripe screening or Checkr credentials configured in Vercel.
- Stripe writes repeatedly returned "Authentication ... requested and accepted.
  Retry this tool call now." No successful product creation was confirmed.
- Checkr Settings requires sign-in in the task browser.

Tests: `node --test tests/screening.test.mjs`.
