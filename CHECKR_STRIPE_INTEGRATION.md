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

## Implementation updated October 28, 2026

A $79 Stripe SANDBOX Payment Link is configured for the single-payment flow.
Stripe's signed paid event is the only trigger for a business-paid Checkr Essential
test order. Sensitive identity information is entered directly with Checkr.
No live payments or live screening orders are enabled.

Runtime flags and credentials are stored in Vercel. All Checkr calls require a
`ckr_sk_test_` key. The payment link must be a Stripe `/test_` URL. A separate
admin Bearer token protects test invitations, connection tests and status polling.
No credentials are included in source or browser JavaScript.

The synthetic test ledger is `screening_test_applications`, isolated from real
client records in the existing Supabase project. RLS is enabled; anonymous and
signed-in visitors have no direct access. The server uses the existing service
role. `screening_test_payment_reviews` tracks extra paid test sessions requiring
review. No raw reports, SSNs or DOBs are persisted.

Public page: `/rental-screening.html` displays the planned $79 price and clearly
states real payments are not yet open. Private test page: `/screening-payment.html`.
Invitation tokens are in the fragment and removed from browser history on load.

Configuration (server only):
- CHECKR_TEST_API_KEY
- SCREENING_TEST_ENABLED=true
- SCREENING_TEST_SITE_URL=https://www.aplynxinvestments.com
- STRIPE_SCREENING_TEST_PAYMENT_URL
- STRIPE_SCREENING_TEST_LINK_ID
- STRIPE_SCREENING_TEST_WEBHOOK_SECRET
- SCREENING_TEST_ADMIN_TOKEN
- Existing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

`POST /api/screening-test` requires an Origin matching the configured site.
Staff requests also require the test admin Bearer token. Staff actions:
- `connectivity`: Checkr test API authentication check, no order.
- `smoke`: one synthetic Essential order; returns only its id and status.
- `invite`: applicant first_name,last_name,email; Georgia property street,city,
  state,zipcode,unit; availability_confirmed,fee_rules_reviewed,own_organization
  must all be true. Returns a private test checkout link.
- `refresh`: application UUID to poll the order and save report product statuses.

The applicant follows the invitation, reviews terms, and visits Stripe's sandbox
checkout. A signed successful payment with the correct amount, currency, link id
and private application reference claims the test row atomically before ordering.
Checkr test mode does not replay idempotency keys. Ambiguous failures enter
`needs_review` and are never blindly retried. `consider` requires human review;
no automatic approval or denial exists.

Tests: `node --test tests/screening.test.mjs tests/listings.test.mjs`.
Additional provider smoke script: `node scripts/checkr-smoke-test.mjs` after saving
a new test key locally (never put the key in chat). End-to-end payment, failed
payment, refund/reconciliation and provider testing are required before going live.

Live launch requires a connected live Stripe account, Checkr live access and
organization billing, final fee/refund disclosures, availability checks, controlled
report access and monitored reconciliation. This implementation deliberately uses
only sandbox payments and Checkr test keys. Testing on the production hostname
does not make payments live. Do not swap in a live key to enable this test code.
