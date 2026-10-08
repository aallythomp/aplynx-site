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
    if (url.endsWith('maintenance_email_batch')) return response([{ notification_id: id, email: 'manager@example.com', kind: 'request', request_id: id }]);
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
    if (url.endsWith('maintenance_email_batch')) return response([{ notification_id: id, email: 'manager@example.com', kind: 'request', request_id: id }]);
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
    if (url.endsWith('maintenance_email_batch')) return response([]);
    if (url.includes('maintenance_invites?email_sent')) return response([{ id, email: 'tenant@example.com', role: 'tenant', expires_at: new Date(Date.now()+86400000).toISOString() }]);
    if (url.includes('resend.com')) { destination = JSON.parse(opts.body).to; return response({ id: 'sent' }); }
    if (opts.method === 'PATCH') { marked = true; return new Response(null, { status: 204 }); }
    throw new Error('Unexpected request');
  };
  try { assert.equal((await handle(request({}, 'cron-secret'), env)).status, 200); assert.deepEqual(destination, ['tenant@example.com']); assert.ok(marked); }
  finally { global.fetch = original; }
});
