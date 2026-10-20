import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../api/maintenance.mjs';

const id = '00000000-0000-0000-0000-000000000001';
const env = { SUPABASE_URL: 'https://database.example', SUPABASE_ANON_KEY: 'public', SUPABASE_SERVICE_ROLE_KEY: 'private',
  RESEND_API_KEY: 'mail-secret', MAINTENANCE_FROM_EMAIL: 'Aplynx <maintenance@example.com>',
  MAINTENANCE_SITE_URL: 'https://www.aplynxinvestments.com', MAINTENANCE_CRON_SECRET: 'cron-secret' };
const request = (input, token='tenant-token') => new Request('https://www.aplynxinvestments.com/api/maintenance', {
  method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(input) });
const response = data => new Response(JSON.stringify(data));
test('public config never exposes server keys', async () => {
  const res = await handle(new Request('https://site/api/maintenance'), env);
  const body = await res.text(); assert.match(body, /public/); assert.doesNotMatch(body, /private|mail-secret|cron-secret/);
});
test('unconfigured portal and missing auth are rejected', async () => {
  assert.equal((await handle(request({ request: id }), {})).status, 503);
  assert.equal((await handle(request({ request: id }, null), env)).status, 401);
});
test('ambiguous, malformed, and null identifiers cannot reach the database', async () => {
  for (const input of [null, [], { request: id, invite: 'bad' }, { invite: 'bad' }, { request: {} }])
    assert.equal((await handle(request(input), env)).status, 400);
});
test('RLS denied ticket cannot trigger an email', async () => {
  const original = global.fetch; let count = 0;
  global.fetch = async (url, opts) => { count++; assert.equal(opts.headers.Authorization, 'Bearer tenant-token'); return response([]); };
  try { assert.equal((await handle(request({ request: id }), env)).status, 403); assert.equal(count, 1); }
  finally { global.fetch = original; }
});
test('recipient comes from database, not the submitted address; success is recorded', async () => {
  const original = global.fetch; let sent, marked = false;
  global.fetch = async (url, opts) => {
    if (url.includes('maintenance_requests?')) return response([{ id }]);
    if (url.endsWith('maintenance_alert_batch')) return response([{ notification_id: id, email: 'manager@example.com', kind: 'request', request_id: id, email_pending: true, sms_pending: false }]);
    if (url === 'https://api.resend.com/emails') { sent = JSON.parse(opts.body); assert.equal(opts.headers['Idempotency-Key'], `maintenance/${id}`); return response({ id: 'delivered' }); }
    if (opts.method === 'PATCH') { marked = true; return new Response(null, { status: 204 }); }
    throw new Error('Unexpected request');
  };
  try {
    assert.equal((await handle(request({ request: id, email: 'attacker@example.com' }), env)).status, 200);
    assert.deepEqual(sent.to, ['manager@example.com']); assert.match(sent.text, /maintenance.html\?request=/); assert.ok(marked);
  } finally { global.fetch = original; }
});
test('email failure leaves outbox item unsent for retry', async () => {
  const original = global.fetch; let marked = false;
  global.fetch = async (url, opts) => {
    if (url.includes('maintenance_requests?')) return response([{ id }]);
    if (url.endsWith('maintenance_alert_batch')) return response([{ notification_id: id, email: 'manager@example.com', kind: 'request', request_id: id, email_pending: true, sms_pending: false }]);
    if (url.includes('resend.com')) return new Response('unavailable', { status: 503 });
    if (opts.method === 'PATCH') marked = true;
    throw new Error('Unexpected request');
  };
  try { assert.equal((await handle(request({ request: id }), env)).status, 502); assert.equal(marked, false); }
  finally { global.fetch = original; }
});
test('invitation recipient cannot dispatch the inviter’s invitation', async () => {
  const original = global.fetch;
  global.fetch = async url => url.includes('/auth/v1/user') ? response({ id: 'recipient' }) : response([{ id, invited_by: 'inviter' }]);
  try { assert.equal((await handle(request({ invite: id }), env)).status, 403); }
  finally { global.fetch = original; }
});
test('cron retries saved invitations and records delivery', async () => {
  const original = global.fetch; let destination, marked = false;
  global.fetch = async (url, opts) => {
    if (url.endsWith('maintenance_alert_batch')) return response([]);
    if (url.includes('maintenance_invites?email_sent')) return response([{ id, email: 'tenant@example.com', role: 'tenant', expires_at: new Date(Date.now()+86400000).toISOString() }]);
    if (url.includes('resend.com')) { destination = JSON.parse(opts.body).to; return response({ id: 'sent' }); }
    if (opts.method === 'PATCH') { marked = true; return new Response(null, { status: 204 }); }
    throw new Error('Unexpected request');
  };
  try { assert.equal((await handle(request({}, 'cron-secret'), env)).status, 200); assert.deepEqual(destination, ['tenant@example.com']); assert.ok(marked); }
  finally { global.fetch = original; }
});

const smsEnv = { ...env, MAINTENANCE_SMS_ENABLED: 'true', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'sms-secret', TWILIO_MESSAGING_SERVICE_SID: 'MGtest' };
const smsItem = { notification_id: id, kind: 'request', request_id: id, email_pending: false, sms_pending: true };
test('public config reports SMS readiness without exposing messaging credentials', async () => {
  const text = await (await handle(new Request('https://site/api/maintenance'), smsEnv)).text();
  assert.match(text, /"smsReady":true/); assert.doesNotMatch(text, /ACtest|MGtest|sms-secret/);
});
test('text-only recipient receives no email, and address and phone come only from server records', async () => {
  const original = global.fetch; let accepted = false;
  global.fetch = async (url, opts) => {
    if (url.includes('maintenance_requests?')) return response([{ id }]);
    if (url.endsWith('maintenance_alert_batch')) return response([smsItem]);
    if (url.endsWith('maintenance_claim_sms')) return response([{ phone: '+14045550123' }]);
    if (url.includes('api.twilio.com')) { const body = new URLSearchParams(opts.body); assert.equal(body.get('To'), '+14045550123'); assert.equal(body.get('MessagingServiceSid'), 'MGtest'); assert.match(body.get('Body'), /STOP/); assert.doesNotMatch(body.get('Body'), /tenant|leak|5559999/); return response({ sid: 'SMaccepted' }); }
    if (url.includes('maintenance_sms_deliveries?')) { const body = JSON.parse(opts.body); assert.equal(body.state, 'accepted'); assert.equal(body.provider_id, 'SMaccepted'); accepted = true; return new Response(null, { status: 204 }); }
    throw new Error('Unexpected delivery: ' + url);
  };
  try { assert.equal((await handle(request({ request: id, phone: '+14045559999' }), smsEnv)).status, 200); assert.ok(accepted); }
  finally { global.fetch = original; }
});
test('both channels are attempted independently when email fails', async () => {
  const original = global.fetch; let texts = 0;
  global.fetch = async (url, opts) => {
    if (url.includes('maintenance_requests?')) return response([{ id }]);
    if (url.endsWith('maintenance_alert_batch')) return response([{ ...smsItem, email: 'owner@example.com', email_pending: true }]);
    if (url.includes('resend.com')) return new Response('unavailable', { status: 503 });
    if (url.endsWith('maintenance_claim_sms')) return response([{ phone: '+14045550123' }]);
    if (url.includes('twilio.com')) { texts++; return response({ sid: 'SMok' }); }
    if (opts.method === 'PATCH') return new Response(null, { status: 204 });
    throw new Error('Unexpected request');
  };
  try { const res = await handle(request({ request: id }), smsEnv); assert.equal(res.status, 502); assert.deepEqual(await res.json(), { delivered: 1, pending: 1 }); assert.equal(texts, 1); }
  finally { global.fetch = original; }
});
test('missing SMS activation does not falsely report sent or claim a paid text', async () => {
  const original = global.fetch;
  global.fetch = async url => { if (url.includes('maintenance_requests?')) return response([{ id }]); if (url.endsWith('maintenance_alert_batch')) return response([smsItem]); throw new Error('Must not send or claim'); };
  try { const res = await handle(request({ request: id }), env); assert.equal(res.status, 502); assert.deepEqual(await res.json(), { delivered: 0, pending: 1 }); }
  finally { global.fetch = original; }
});
test('an already claimed SMS is not sent again', async () => {
  const original = global.fetch;
  global.fetch = async url => { if (url.includes('maintenance_requests?')) return response([{ id }]); if (url.endsWith('maintenance_alert_batch')) return response([smsItem]); if (url.endsWith('maintenance_claim_sms')) return response([]); throw new Error('Duplicate send'); };
  try { const res = await handle(request({ request: id }), smsEnv); assert.equal(res.status, 200); assert.equal((await res.json()).delivered, 0); }
  finally { global.fetch = original; }
});
test('ambiguous SMS network result is marked unknown rather than retried automatically', async () => {
  const original = global.fetch; let state;
  global.fetch = async (url, opts) => { if (url.includes('maintenance_requests?')) return response([{ id }]); if (url.endsWith('maintenance_alert_batch')) return response([smsItem]); if (url.endsWith('maintenance_claim_sms')) return response([{ phone: '+14045550123' }]); if (url.includes('twilio.com')) throw new Error('Timeout'); if (opts.method === 'PATCH') { state = JSON.parse(opts.body).state; return new Response(null, { status: 204 }); } throw new Error('Unexpected'); };
  try { assert.equal((await handle(request({ request: id }), smsEnv)).status, 502); assert.equal(state, 'unknown'); }
  finally { global.fetch = original; }
});
