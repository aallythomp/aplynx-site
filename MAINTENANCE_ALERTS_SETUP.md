# Maintenance accounts and alert preferences

Owners and authorized property managers register using their own verified email at `/maintenance.html`, save their contact details, register their properties and invite residents. Existing property/request row-level security remains in place. The self-managed property contact may be its owner or an authorized property manager. Aplynx-managed routing still requires an approved Aplynx account; registration does not grant access to anyone else's property.

## Notification choices

Each signed-in contact has an account-level preference: email, SMS, or both. Existing accounts default to email. Sign-in codes and invitations always use email. Phone numbers and SMS consent are stored in a separate table readable only by that account; notification dispatch is server-only. SMS includes a generic alert and authenticated portal link, without repair details, addresses, names or resident contact information. Changing back to email removes SMS consent for future dispatches. Historical notifications before SMS consent are not texted.

The additive `database/maintenance-alerts.sql` was applied to the site's existing Supabase project. It adds preference and SMS-delivery tables, preserves existing records and policies, and supplies bounded server-only dispatch/claim functions. A claim prevents simultaneous duplicate SMS sends. A network result with uncertain acceptance is marked `unknown`, which requires operator review rather than an automatic duplicate paid send. SMS is capped at 20 accepted/in-flight notifications per recipient per day. Definite failures can be retried up to three attempts with at least 15 minutes between attempts, when the authenticated request endpoint is called again or an authorized outbox job runs. No new recurring retry job is configured by this change.

## Text activation still required

No SMS provider account, paid sender, or billable text was created. No live SMS was sent. Text options remain unavailable until a real service is connected and tested. The implementation uses Twilio's Messaging Service API. Configure these server-side Vercel production variables only after the account owner connects an approved service and its sender is ready:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN` (sensitive)
- `TWILIO_MESSAGING_SERVICE_SID`
- `MAINTENANCE_SMS_ENABLED=true` (set last, after testing)

Set up the sender and applicable messaging registration in Twilio, enable/test STOP and HELP handling, verify the privacy/consent disclosures for the service, and test with a consenting recipient. Keep secrets out of browser code and Git. Existing email setup remains unchanged. `/api/maintenance` exposes only a boolean `smsReady`, never messaging credentials. Provider acceptance is recorded as `accepted`; it does not prove handset delivery. Inspect Twilio delivery logs for final delivery and opt-outs.

The Stripe Directory CLI was attempted first for SMS-provider discovery, but its plugin could not run in this environment (Unix socket and broker errors). Twilio's official Message Resource and Messaging Service documentation was used for the integration contract.

## Validation

API tests cover private configuration, signed-in request access, database-derived recipients, separate channel dispatch, SMS activation disabled, duplicate claims, uncertain provider acceptance, and partial channel failure. Transactional database checks use isolated users/properties and roll back all fixtures; they verify own-account preferences, normalized phone numbers, consent validation, cross-account property isolation, and rejection of an unrelated user's request submission.
