# APLYNX $79 application payment + Checkr Tenant integration

Status: TEST STAGING ONLY. DO NOT ENABLE LIVE CUSTOMER CHECKOUT.

## Business decisions
- Proposed applicant charge: $79 total (single payment through APLYNX/Stripe).
- Checkr Tenant screening: Essential, business-paid, final cost/terms to confirm.
- Brokerage approval: user reports approved. Check local fee rules, property-owner authorization, and applicable screening requirements prior to launch.
- Applicant must see all fees and refund policy before paying. $79 is not a guarantee of approval or reservation.
- The existing Checkr property share link is **applicant-paid**; it cannot be used after charging $79 without double-charging. It must be removed/replaced in the finished single-pay flow.

## Configuration (server-only environment variables)
- CHECKR_TEST_API_KEY: ROTATED test key, never store in git, browser JS, email, or chat.
- CHECKR_TEST_WEBHOOK_SECRET: signing secret from Checkr developer settings.
- CHECKR_LIVE_API_KEY / CHECKR_LIVE_WEBHOOK_SECRET: after approval and complete tests ONLY.
- STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET: restricted account-specific keys set through Vercel dashboard, not via ChatGPT account OAuth.
- CHECKR_SCREENING_ENABLED=false ; APPLICATION_PAYMENTS_ENABLED=false until reviewed.

## Secure workflow
1. Authenticated admin verifies availability of the specific room; mark rented rooms non-applicable.
2. Applicant enters only necessary ordinary contact and housing application data; Checkr gathers SSN and sensitive identity details directly.
3. Server persists unique application id and idempotency key. Review fee disclosure, authorization, privacy, refund terms.
4. Server creates Stripe Checkout session using fixed catalog price ($79) and stable application id; never trust browser-provided amounts.
5. Verify signed Stripe webhook on server; only when fully paid and application is eligible, place one business-paid Checkr order with idempotency protections. Never initiate screening on redirect/success page alone.
6. Checkr emails applicant invitation. Signed Checkr webhook updates status; show only minimal status to assigned Jackie and restricted reports to licensed/authorized users.
7. Reconcile payments, screening cost, refunds, failed orders; notify staff if screening order fails. Refund or remedy unfulfilled payment according to disclosed terms.
8. Send FCRA adverse-action notices as required; Checkr Tenant does not send them automatically.

## Launch blockers
- New rotated test key placed in secure Vercel env; previously exposed test key must be revoked.
- Integration tests against official Checkr API reference and signed webhook fixtures.
- Checkr live access and business billing approved; cost/package and original_requester requirements confirmed.
- Live Stripe website credentials, signed webhook destination and production domain configured.
- End-to-end test from application to checkout, one Checkr order, CRM updates, retries, declines, refunds.
- Validate Georgia + Powder Springs local application fee rules and fair housing practices.

Official docs: https://tenant.checkr.com/developers , https://tenant.checkr.com/resources/faq
