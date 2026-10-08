# Aplynx maintenance portal

This draft integrates `/maintenance.html` with the existing static Vercel website. Do not merge until the production database, email sender, sign-in emails, and notification retry schedule have been configured and the acceptance checks below pass. It does not connect the separate ChatGPT Client Hub database automatically; property contacts can be exported as CSV.

## Connections and configuration

1. Connect the intended Supabase project and Vercel project for `www.aplynxinvestments.com`. Apply `supabase/maintenance.sql` once. Use a dedicated project or review the names before applying to an existing database. Keep this migration out of the public static output.
2. Confirm that `allynthompson27@gmail.com` is Allyn's portal sign-in account before launch. The migration allows that verified address to register Aplynx-managed properties. No password or service key is committed.
3. In Supabase Authentication, allow email sign-in. Configure a verified SMTP sender (Resend can provide it). Change the Magic Link email template to show `{{ .Token }}` as the sign-in code. Set the site URL to `https://www.aplynxinvestments.com`; email codes are verified in the page, so no redirect token is needed. Confirm new-account signup is enabled for invited tenants and property owners, and configure appropriate auth email limits/CAPTCHA before public launch.
4. Verify the sending domain with Resend. Set these encrypted Vercel environment variables for production and preview, using separate preview resources when practical:

   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (public anon key; RLS must remain enabled)
   - `SUPABASE_SERVICE_ROLE_KEY` (server only)
   - `RESEND_API_KEY` (server only)
   - `MAINTENANCE_FROM_EMAIL` (verified sender, e.g. `Aplynx Investments <maintenance@aplynxinvestments.com>`)
   - `MAINTENANCE_SITE_URL=https://www.aplynxinvestments.com`
   - `MAINTENANCE_CRON_SECRET` (long random server-only token)

5. Configure a trusted scheduler to POST `{}` to `/api/maintenance` at least every five minutes with `Authorization: Bearer <MAINTENANCE_CRON_SECRET>`. This retries pending request/message/status alerts and invitations. Do not put the token in a browser script or public configuration. Immediate delivery is also attempted after a saved user action. Failed email delivery never rolls back the saved request.
6. Deploy a preview and run the acceptance checks. Merge only after those pass, then verify production using test accounts before sending real invitations.

## Property setup

- Aplynx-managed property: Allyn signs in, saves contact details, registers with “Aplynx manages this property,” and invites the owner and tenants. New-request alerts route to Allyn's account.
- Owner-managed property: the owner signs in and registers their property, then invites tenants. New-request alerts route to that owner.
- Switching to Aplynx: the owner invites the verified Aplynx account as manager. Once Allyn accepts, routing changes to Aplynx. Switching back to owner requires an accepted owner account.
- Invitations are tied to the recipient's verified email, expire after seven days, and confer access only after acceptance. The user cannot choose an arbitrary alert recipient when submitting a request.

## Data and access

Contact profiles store verified email, name, and optional phone. Property owners/managers can export their tenants' contact records. This is service data, not marketing consent. Requests, messages, status changes, and private files are retained in Supabase. The separate Client Hub's imported clients are unchanged.

Tenant access is limited to their own requests. Owners and assigned managers see the property's requests. Private storage permissions follow the request's access rules, and file links expire after five minutes. Per-file limit: 25 MB; up to five files per UI upload. Private files are not made public.

Request and message alerts are held in a persistent outbox, addressed server-side, and use Resend idempotency keys. The email includes only a portal link, not issue details or attachments. Retry promptly: Resend's idempotency window is finite, so a process failure after delivery but before recording success can produce a duplicate after that window.

## Validation

Run `node --test tests/maintenance-api.test.mjs` and syntax-check `api/maintenance.mjs` plus `assets/maintenance.js`. For the real PostgreSQL access/routing test, install `@electric-sql/pglite@0.5.8` in a temporary directory and run `PGLITE_MODULE=/absolute/path/to/node_modules/@electric-sql/pglite/dist/index.js node --test tests/maintenance-database.test.mjs`. The test applies the actual migration to PostgreSQL with minimal mocked auth/storage schemas; it does not replace real Supabase integration checks. Integration checks in a real Supabase preview are required because the local API tests mock Supabase/Resend:

1. Sign in as Allyn, an owner, two tenants on one property, and a user on a different property.
2. Verify a managed property's new request sends only to Allyn; a self-managed property's new request sends only to its owner.
3. Verify each tenant cannot query the other's tickets/messages/files through direct REST or Storage calls; the unrelated user has no property access.
4. Verify users cannot change property ownership/management through direct table writes or assign a non-Aplynx manager. Verify an invitation cannot be accepted with a different email.
5. Submit a request with images and a video, reply as owner, and confirm the tenant receives an email and sees the conversation. Confirm file URLs expire.
6. Simulate Resend failure; saved requests and messages must remain readable and the retry job must deliver afterward.
7. Test mobile layout, code sign-in, routing switches, status updates, contact export, and production sender authentication.

Supabase setup completed on October 8, 2026 for project `xobkinawxphmdcoaaxvs` in the Free-plan Aplynx Maintenance organization. The initial schema and access/index migration are applied. All eight maintenance tables have RLS enabled; the maintenance bucket is private, with a 25 MB per-file limit; no maintenance RPC is callable by the anon role. A transaction-scoped live SQL test passed managed/owner routing and unrelated-user access restrictions, and rolled back all test accounts, tickets, and alerts.

Advisor findings reviewed: two [RLS tables without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) are intentional server-only admin/outbox tables, with user grants revoked. Twelve [authenticated SECURITY DEFINER functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) are intentional, checked RPCs and RLS permission helpers; user identity and property/request access are validated. The anonymous executable default RLS trigger function was locked down. These advisor findings are design review notices, not proof of failed isolation; retain live role/REST acceptance testing before launch.

Budget constraint: keep Supabase and Resend on their Free plans and do not enable paid upgrades or add-ons. Supabase Free file storage is limited to 1 GB; monitor aggregate attachment usage. Verify the existing Vercel plan before deployment changes that would incur charges.

Still pending: browser-level Supabase sign-in and upload tests, configuring SMTP and Resend's sender domain, connecting Vercel environment variables, scheduling retries, and preview/production acceptance tests. The portal remains a draft and is not available on the main website.
