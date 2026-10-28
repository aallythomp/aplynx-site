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

## Implementation added October 28, 2026

The `screening-payments-test` branch implements a **test-only** $79 Stripe
Checkout → verified Stripe webhook → business-paid Checkr Essential order flow.
No production checkout is enabled. The existing applicant-paid property link on
the public rental page is unchanged, and is not used by this flow.

### Current verification

- `node --test tests/screening.test.mjs`: nine mocked tests pass, covering
  signature verification, tampering, delayed payments, incorrect totals,
  concurrent duplicate deliveries, ambiguous failures, and live-mode rejection.
- Actual Checkr orders have NOT been tested. Vercel confirms the presence of
  a saved secret, but does not return its value. Earlier notes require rotation.
- Stripe test credentials, a signed webhook, and test storage are not configured.
- SQL is prepared in `db/screening-test-setup.sql`; it has NOT been applied.
- Browser flow and database concurrency need end-to-end verification before merge.

### Test configuration (server only, Preview/Development)

- `CHECKR_TEST_API_KEY`: newly rotated `ckr_sk_test_…` key.
- `STRIPE_SCREENING_TEST_KEY`: account-specific sandbox restricted key with
  Checkout Session creation permission. Never use a live key.
- `STRIPE_SCREENING_TEST_WEBHOOK_SECRET`: signing secret for the sandbox endpoint
  `/api/stripe-screening-webhook`; subscribe to `checkout.session.completed`
  and `checkout.session.async_payment_succeeded`.
- `SCREENING_TEST_ENABLED=true`.
- `SCREENING_TEST_SITE_URL`: exact HTTPS preview origin.
- `SCREENING_TEST_ADMIN_TOKEN`: random secret of at least 32 characters, used
  in a Bearer header by staff tooling; do not embed in a webpage.
- `SCREENING_TEST_SUPABASE_URL` and `SCREENING_TEST_SUPABASE_SERVICE_KEY`:
  separate test database credentials; the production database is rejected.

Use a separately configured Supabase test database and apply the setup SQL
there. Tables have RLS enabled and no anonymous/authenticated grants; server
service-role access only. Store only synthetic test applicants in this version.
No new dependencies or cloud resources were created by this change.

### Staff and applicant flow

`POST /api/screening-test` with `action: invite`, staff Bearer authorization,
and an Origin matching the test site creates a private test invitation. Input:
`applicant: {first_name,last_name,email}`, `property: {street,city,state,zipcode,unit?}`,
`availability_confirmed: true`, `fee_rules_reviewed: true`, `own_organization: true`.
Only Georgia properties and screening for APLYNX's own organization are supported.
It returns a private link to `screening-payment.html`; keep that link confidential.
Applicants review the total and test refund terms, then use Stripe's test checkout.
Stripe's signed paid event is the only trigger for an order. The success page
never initiates an order or claims payment was verified.

Staff can POST `action: refresh, id: <application UUID>` with the same staff
credentials to poll order/report status. Only report id and product statuses are
stored. `consider` requires human review; no approval/denial is automated.
This version uses polling instead of a Checkr webhook. No Checkr webhook URL
should be registered for this branch.

Test order creation is never automatically retried: Checkr test mode does NOT
replay idempotency keys. Ambiguous outcomes become `needs_review`; reconcile in
Checkr before any manual new order. The atomic database claim prevents concurrent
webhook deliveries creating extra test orders. A crash after claiming also
requires staff review. Add monitored reconciliation before a live launch.

### Checkr smoke check

After saving the rotated test key as an environment variable, run
`node scripts/checkr-smoke-test.mjs`. This creates synthetic Complete and Starter
orders and prints only ids and product statuses. Keys and full reports are never
printed. It deliberately rejects live keys.

### Decisions retained for review

- $79 total is the existing PROPOSED price, not a newly approved final fee.
- Essential screening; no identity add-on. APLYNX processing included in total.
- Margin remains unknown until actual Checkr cost, payment processing and
  applicable application-fee rules are confirmed.
- Test page refund language is illustrative; final live terms remain open.
- No raw SSN/DOB collected in the application or persisted. Only the synthetic
  smoke-test fixture submits the provider's documented test SSN and DOB.
- Third-party landlord/customer screening is unsupported until requester data,
  report access controls and authorization are implemented.

Before going live: finish sandbox end-to-end testing, confirm the final price
and disclosures, obtain Checkr production access, configure organization billing,
add separate live payment credentials/webhooks, complete refund and failed-order
reconciliation, and replace the public applicant-pay link when enabling the
single-payment flow. The current code intentionally rejects production and live
keys, so merely adding a live key cannot enable charging.
