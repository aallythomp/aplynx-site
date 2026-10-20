// Web Handler matches the site's existing api/chat.mjs Vercel runtime.
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

async function database(env, path, { token, method = 'GET', body, service = false } = {}) {
  const key = service ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${token || key}`,
      'Content-Type': 'application/json', ...(method === 'PATCH' ? { Prefer: 'return=minimal' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) throw new Error('Database request failed');
  return response.status === 204 ? null : response.json();
}

const smsReady = env => Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_MESSAGING_SERVICE_SID && env.MAINTENANCE_SMS_ENABLED === 'true');

async function deliver(env, item) {
  const url = new URL('/maintenance.html', env.MAINTENANCE_SITE_URL);
  if (item.request_id) url.searchParams.set('request', item.request_id);
  const subjects = { request: 'New maintenance request', message: 'New private maintenance message',
    status: 'Maintenance request updated', invite: 'You are invited to the Aplynx maintenance portal' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json', 'Idempotency-Key': `maintenance/${item.notification_id}` },
    body: JSON.stringify({ from: env.MAINTENANCE_FROM_EMAIL, to: [item.email],
      subject: subjects[item.kind], text: `${subjects[item.kind]}.\n\nSign in with this email address to view it privately:\n${url.href}\n\nAPLYNX Investments` })
  });
  if (!response.ok) throw new Error('Email delivery unavailable');
  await database(env, `/rest/v1/maintenance_notifications?id=eq.${item.notification_id}`, {
    service: true, method: 'PATCH', body: { sent_at: new Date().toISOString() }
  });
}

async function deliverText(env, item) {
  if (!smsReady(env)) throw new Error('Text alerts are awaiting activation');
  const claimed = await database(env, '/rest/v1/rpc/maintenance_claim_sms', {
    service: true, method: 'POST', body: { p_notification: item.notification_id }
  });
  if (!claimed.length) return false;
  const url = new URL('/maintenance.html', env.MAINTENANCE_SITE_URL);
  url.searchParams.set('request', item.request_id);
  const titles = { request: 'New maintenance request', message: 'New maintenance message', status: 'Maintenance status updated' };
  // Keep private repair details and resident contact information out of lock-screen alerts.
  const body = new URLSearchParams({ To: claimed[0].phone, MessagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
    Body: `APLYNX: ${titles[item.kind] || 'Maintenance update'}. Sign in to view: ${url.href} Reply STOP to opt out; HELP for help.` });
  let state = 'unknown', providerId = null;
  try {
    const result = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`, {
      method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: AbortSignal.timeout(10000)
    });
    // Ambiguous failures must not automatically send a duplicate paid text.
    if (!result.ok) { state = result.status >= 500 ? 'unknown' : 'failed'; throw new Error('Text delivery unavailable'); }
    const data = await result.json();
    if (!data.sid) throw new Error('Text response could not be confirmed');
    state = 'accepted'; providerId = data.sid;
  } finally {
    await database(env, `/rest/v1/maintenance_sms_deliveries?notification_id=eq.${item.notification_id}`, {
      service: true, method: 'PATCH', body: { state, provider_id: providerId, updated_at: new Date().toISOString() }
    });
  }
  return true;
}

export async function handle(request, env = process.env) {
  const config = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
  if (request.method === 'GET') return json({ ready: config, smsReady: smsReady(env), url: config ? env.SUPABASE_URL : null,
    key: config ? env.SUPABASE_ANON_KEY : null });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!config || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY || !env.MAINTENANCE_FROM_EMAIL || !env.MAINTENANCE_SITE_URL)
    return json({ error: 'Email alerts are not configured. Your saved request remains in the portal.' }, 503);
  if (Number(request.headers.get('content-length')) > 2048) return json({ error: 'Request too large' }, 413);
  const isCron = env.MAINTENANCE_CRON_SECRET && request.headers.get('authorization') === `Bearer ${env.MAINTENANCE_CRON_SECRET}`;
  let input;
  try { const raw = await request.text(); if (raw.length > 2048) return json({ error: 'Request too large' }, 413); input = JSON.parse(raw); }
  catch { return json({ error: 'Invalid request' }, 400); }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'Invalid request' }, 400);
  const identifiers = [input.request, input.invite].filter(value => value !== undefined);
  if (identifiers.length > 1 || identifiers.some(value => typeof value !== 'string' || !uuid.test(value)) || (!isCron && identifiers.length !== 1))
    return json({ error: 'One valid request or invitation required' }, 400);
  try {
    if (!isCron) {
      const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
      if (!token) return json({ error: 'Sign in required' }, 401);
      // This query uses the user's JWT and RLS. It cannot send alerts for an inaccessible request.
      const resource = input.invite ? 'maintenance_invites' : 'maintenance_requests';
      const rows = await database(env, `/rest/v1/${resource}?id=eq.${input.invite || input.request}&select=*`, { token });
      if (!rows?.length) return json({ error: 'Access denied' }, 403);
      if (input.invite) {
        const user = await database(env, '/auth/v1/user', { token });
        if (rows[0].invited_by !== user.id) return json({ error: 'Access denied' }, 403);
        // Keep invite retries idempotent without putting arbitrary email recipients in the API input.
        await deliverInvite(env, rows[0]);
        return json({ delivered: 1 });
      }
    }
    const batch = await database(env, '/rest/v1/rpc/maintenance_alert_batch', {
      service: true, method: 'POST', body: { p_request: input.request || null }
    });
    let delivered = 0, pending = 0;
    for (const item of batch) {
      if (item.email_pending) { try { await deliver(env, item); delivered++; } catch { pending++; } }
      if (item.sms_pending) { try { if (await deliverText(env, item)) delivered++; } catch { pending++; } }
    }
    if (isCron) {
      const invites = await database(env, '/rest/v1/maintenance_invites?email_sent_at=is.null&accepted_at=is.null&expires_at=gt.' + encodeURIComponent(new Date().toISOString()) + '&limit=50', { service: true });
      for (const invite of invites) { await deliverInvite(env, invite); delivered++; }
    }
    return json({ delivered, pending }, pending ? 502 : 200);
  } catch { return json({ error: 'Alerts are pending. Your saved data remains available in the portal.' }, 502); }
}

async function deliverInvite(env, invite) {
  if (invite.email_sent_at || invite.accepted_at || new Date(invite.expires_at) <= new Date()) return;
  const url = new URL('/maintenance.html', env.MAINTENANCE_SITE_URL);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
      'Idempotency-Key': `maintenance/invite/${invite.id}` },
    body: JSON.stringify({ from: env.MAINTENANCE_FROM_EMAIL, to: [invite.email],
      subject: 'Invitation to Aplynx maintenance', text: `You have been invited as a property ${invite.role}.\n\nSign in using this email address and accept your invitation:\n${url.href}\n\nThis invitation expires in 7 days.\nAPLYNX Investments` })
  });
  if (!response.ok) throw new Error('Email delivery unavailable');
  await database(env, `/rest/v1/maintenance_invites?id=eq.${invite.id}`, { service: true, method: 'PATCH', body: { email_sent_at: new Date().toISOString() } });
}
export default async function handler(req,res){
 const origin='https://www.aplynxinvestments.com';
 const headers=new Headers();for(const [key,value]of Object.entries(req.headers||{}))if(value!=null)headers.set(key,Array.isArray(value)?value.join(','):String(value));
 const request=new Request(origin+'/api/maintenance',{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:typeof req.body==='string'?req.body:JSON.stringify(req.body||{})}:{})});
 const result=await handle(request);res.status(result.status);for(const [key,value]of result.headers)res.setHeader(key,value);res.send(await result.text());
}
