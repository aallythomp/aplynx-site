# APLYNX Agent Hub — activation review

## User-approved scope
Georgia agents request showing coverage, screened agents claim available jobs, and APLYNX earns $7 per completed showing in addition to the agreed showing-agent fee. Broker approval was reported by Allyn on October 14, 2026. No automatic payment or payout is represented as connected.

## Database approval required
The additive SQL in `database/agent-hub.sql` creates five private, RLS-enabled public-schema tables (profiles, jobs, settings, push subscriptions, audit events) and one private-schema administrator table. It does not modify or delete any existing CRM, leasing, tenant or maintenance data. The administrator table recognizes only Allyn's two existing Supabase user IDs, associated with info@aplynxinvestments.com and allynthompson27@gmail.com. Jackie and ordinary registrants do not receive administrator access.

Authenticated RPCs enforce verified email, private record access, document-based human screening review, license/screening expiry, and atomic first-successful-claim assignment. Other eligible agents see only city, ZIP, time and fee, not the full property address or the requester's contacts. Full details are restricted to participants and administrators. There are no anonymous table grants or direct authenticated table writes. Provider screening reports, SSNs, birth dates and criminal history are not collected by these forms. Audit records identify administrative reviews and job changes. Review launch approval is recorded as reported by the user; no claim of independent legal certification is made.

## Remaining external setup
1. Obtain explicit approval to apply this production database schema and activate intake. Automatic approval review blocked the initial database application; it has not run.
2. Connect an approved contractor-background-screening provider account, finalize separate disclosures/authorization, screening criteria, human review and any required pre-adverse/adverse-action and dispute process. A generic checkbox or tenant screening account is not a substitute. Nobody is pre-marked screened or eligible.
3. Finalize brokerage-approved coverage scope, access authorization, client relationship protections, cancellation/no-show terms, insurance responsibilities and compensation routing. Do not collect lockbox credentials in this hub.
4. Configure web-push VAPID keys as Vercel runtime environment variables. Only the public key goes to browsers; the private key stays server-side. Notification permission is optional and requested only after a user clicks Enable job alerts. iPhone web push requires a supported installed Home Screen web app.
5. Complete Stripe payment and agent payout setup separately. The displayed $7 fee is recorded in requests; no money is charged, reported paid, held as escrow or paid out by this implementation. Billing is not yet integrated. Never activate a Pay button until real payment verification is configured and tested.

## Runtime configuration
Existing `SUPABASE_URL` and `SUPABASE_ANON_KEY` are reused. After the approved schema is installed, configure `AGENT_HUB_READY=true`, `AGENT_HUB_VAPID_PUBLIC`, and secret `AGENT_HUB_VAPID_PRIVATE`. No Supabase service-role key is needed for this feature; push audience lookup uses the signed-in administrator's JWT and database authorization.

## Verification
API tests cover unauthenticated access, administrator denial, malformed input, cross-origin requests, endpoint restrictions, notification failures and private-key exposure. Before activation, database role/ownership, expiry, duplicate request and concurrent claim tests must also run against an isolated test dataset and be rolled back. No real agent checks, payments or job notifications have been sent.
