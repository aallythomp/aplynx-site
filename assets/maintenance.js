import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm';

const $ = id => document.getElementById(id);
let db, user, properties = [], activeProperty, activeRequest, profiles = new Map(), timer;
const notify = text => { $('notice').textContent = text; };
const check = result => { if (result.error) throw new Error(result.error.message); return result.data; };
const rpc = async (name, args) => check(await db.rpc('maintenance_' + name, args));
const isManager = p => p && [p.owner_id, p.manager_id].includes(user.id);
const label = value => ({ new: 'New', in_progress: 'In progress', resolved: 'Resolved', routine: 'Routine', urgent: 'Urgent' }[value] || value);
const date = value => new Date(value).toLocaleString();
function element(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function empty(id, text) { $(id).replaceChildren(element('p', text)); }
function form(id, action) {
  $(id).addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
    try { await action(); } catch (error) { notify(error.message || 'Unable to save. Please try again.'); }
    finally { button.disabled = false; }
  });
}
async function alertEmail(input) {
  try {
    const session = check(await db.auth.getSession()).session;
    const res = await fetch('/api/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json',
      Authorization: 'Bearer ' + session.access_token }, body: JSON.stringify(input) });
    if (!res.ok) notify('Saved in your private portal. Email delivery is pending; your owner or manager can still view it here.');
  } catch { notify('Saved in your private portal. Email delivery is pending.'); }
}

function files(input) {
  const items = [...input.files];
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
  if (items.length > 5) throw new Error('Choose up to 5 files at a time.');
  for (const file of items) {
    if (!allowed.includes(file.type) || file.size > 25 * 1024 * 1024) throw new Error('Use JPG, PNG, WebP, MP4, WebM or MOV files, up to 25 MB each.');
  }
  return items;
}
async function upload(request, items) {
  for (const file of items) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
    const path = `${request}/${user.id}/${crypto.randomUUID()}-${safeName}`;
    check(await db.storage.from('maintenance').upload(path, file, { contentType: file.type, upsert: false }));
  }
}
async function attachments(request) {
  $('attachments').replaceChildren();
  const folders = check(await db.storage.from('maintenance').list(request, { limit: 100 }));
  for (const folder of folders) {
    const objects = check(await db.storage.from('maintenance').list(`${request}/${folder.name}`, { limit: 100 }));
    for (const file of objects) {
      const { signedUrl } = check(await db.storage.from('maintenance').createSignedUrl(`${request}/${folder.name}/${file.name}`, 300));
      const link = element('a', file.name.replace(/^[0-9a-f-]{36}-/, ''));
      link.href = signedUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
      if (file.metadata?.mimetype?.startsWith('image/')) { const img = element('img'); img.src = signedUrl; img.alt = 'Maintenance photo'; img.loading = 'lazy'; link.prepend(img); }
      $('attachments').append(link);
    }
  }
}
async function loadProfiles(ids) {
  if (!ids.length) return;
  const rows = check(await db.from('maintenance_profiles').select('*').in('id', [...new Set(ids)]));
  for (const row of rows) profiles.set(row.id, row);
}
async function showThread(request) {
  activeRequest = request;
  const rows = check(await db.from('maintenance_requests').select('*').eq('id', request));
  if (!rows.length) { $('thread').hidden = true; return; }
  const r = rows[0], p = properties.find(p => p.id === r.property_id);
  $('thread').hidden = false; $('thread-title').textContent = r.title;
  $('thread-detail').replaceChildren(element('p', `${p?.address || 'Property'} · ${label(r.status)} · ${label(r.urgency)} · ${date(r.created_at)}`), element('p', r.issue, 'message'));
  const messages = check(await db.from('maintenance_messages').select('*').eq('request_id', request).order('created_at'));
  await loadProfiles([r.tenant_id, ...messages.map(m => m.author_id)]);
  const contact = profiles.get(r.tenant_id);
  if (contact && isManager(p)) $('thread-detail').append(element('p', `Contact: ${contact.name} · ${contact.contact_email || contact.email}${contact.phone ? ' · ' + contact.phone : ''}`));
  $('messages').replaceChildren(...messages.map(m => {
    const item = element('article', undefined, 'message');
    item.append(element('small', `${m.author_id === user.id ? 'You' : profiles.get(m.author_id)?.name || 'Property contact'} · ${date(m.created_at)}`), element('p', m.body)); return item;
  }));
  $('status-form').hidden = !isManager(p); $('status').value = r.status;
  await attachments(request);
}
async function requestList() {
  const rows = check(await db.from('maintenance_requests').select('*').eq('property_id', activeProperty.id).order('updated_at', { ascending: false }));
  $('requests').replaceChildren();
  if (!rows.length) return empty('requests', 'No maintenance requests yet.');
  for (const r of rows) {
    const button = element('button', r.title, 'request-item');
    button.append(element('small', `${label(r.status)} · ${label(r.urgency)} · ${date(r.updated_at)}`));
    button.addEventListener('click', () => showThread(r.id).then(() => $('thread').scrollIntoView({ behavior: 'smooth' })).catch(e => notify(e.message)));
    $('requests').append(button);
  }
}
async function propertyView() {
  activeProperty = properties.find(p => p.id === $('property').value);
  $('thread').hidden = true; activeRequest = null;
  $('new-request').hidden = !activeProperty; $('property-tools').hidden = !isManager(activeProperty);
  if (!activeProperty) { $('routing').textContent = 'Accept a property invitation, or register a property you own.'; return empty('requests', 'Your request history will appear here.'); }
  $('routing').textContent = `New requests go to ${activeProperty.mode === 'aplynx' ? 'your Aplynx manager' : 'the property owner'}.`;
  $('mode').value = activeProperty.mode;
  if (isManager(activeProperty)) {
    const contacts = check(await db.from('maintenance_tenants').select('user_id').eq('property_id', activeProperty.id));
    await loadProfiles(contacts.map(c => c.user_id));
    $('contacts').replaceChildren(element('h3', 'Property contacts'));
    for (const c of contacts) { const p = profiles.get(c.user_id); $('contacts').append(element('p', p ? `${p.name} · ${p.contact_email || p.email}${p.phone ? ' · ' + p.phone : ''}` : 'Contact details not saved yet', 'contact')); }
  }
  await requestList();
}
async function loadApp() {
  const session = check(await db.auth.getSession()).session; user = session?.user;
  $('login').hidden = Boolean(user); $('app').hidden = !user; $('signout').hidden = !user;
  clearInterval(timer); $('people-admin-link').hidden = true; if (!user) return;
  $('account-email').textContent = `Signed in as ${user.email}`;
  const profile = check(await db.from('maintenance_profiles').select('*').eq('id', user.id));
  $('name').value = profile[0]?.name || ''; $('phone').value = profile[0]?.phone || '';
  const admin = await rpc('is_admin', {}); $('admin-mode').hidden = !admin; $('people-admin-link').hidden = !admin;
  const invites = check(await db.from('maintenance_invites').select('*').eq('email', user.email.toLowerCase()).is('accepted_at', null).gt('expires_at', new Date().toISOString()));
  $('invitations').hidden = !invites.length; $('invite-list').replaceChildren();
  for (const i of invites) {
    const button = element('button', `Accept ${i.role} invitation`);
    button.addEventListener('click', async () => { button.disabled = true; try { await rpc('accept_invite', { p_invite: i.id }); notify('Property access added.'); await loadApp(); } catch (e) { notify(e.message); button.disabled = false; } });
    $('invite-list').append(button);
  }
  properties = check(await db.from('maintenance_properties').select('*').order('created_at'));
  const selected = $('property').value;
  $('property').replaceChildren(...properties.map(p => { const o = element('option', p.address); o.value = p.id; return o; }));
  if (properties.some(p => p.id === selected)) $('property').value = selected;
  await propertyView();
  const linked = new URL(location.href).searchParams.get('request');
  if (linked && /^[0-9a-f-]{36}$/i.test(linked)) {
    const r = check(await db.from('maintenance_requests').select('property_id').eq('id', linked));
    if (r.length) { $('property').value = r[0].property_id; await propertyView(); await showThread(linked); }
  }
  timer = setInterval(async () => { if (document.hidden || !activeProperty || document.querySelector('button:disabled')) return;
    try { await requestList(); if (activeRequest) await showThread(activeRequest); } catch {} }, 30000);
}

form('email-form', async () => { check(await db.auth.signInWithOtp({ email: $('email').value.trim() })); $('code-form').hidden = false; notify('Check your email for the sign-in code.'); });
form('code-form', async () => { check(await db.auth.verifyOtp({ email: $('email').value.trim(), token: $('code').value.trim(), type: 'email' })); $('code').value = ''; notify('Signed in.'); await loadApp(); });
form('profile-form', async () => { check(await db.from('maintenance_profiles').upsert({ id: user.id, email: user.email.toLowerCase(), name: $('name').value.trim(), phone: $('phone').value.trim(), updated_at: new Date().toISOString() })); notify('Contact information saved privately.'); });
form('property-form', async () => { await rpc('create_property', { p_address: $('address').value, p_mode: $('new-mode').value }); $('address').value = ''; notify('Property added. You can now invite its tenants and owner.'); await loadApp(); });
form('invite-form', async () => { const invite = await rpc('invite', { p_property: activeProperty.id, p_email: $('invite-email').value, p_role: $('invite-role').value }); $('invite-email').value = ''; notify('Invitation saved.'); await alertEmail({ invite }); });
form('mode-form', async () => { await rpc('set_mode', { p_property: activeProperty.id, p_mode: $('mode').value }); notify('Request routing updated.'); await loadApp(); });
form('request-form', async () => {
  const selected = files($('request-files'));
  const request = await rpc('submit', { p_property: activeProperty.id, p_title: $('title').value, p_issue: $('issue').value, p_urgency: $('urgency').value });
  $('request-form').reset(); notify('Your maintenance request is saved.');
  try { await upload(request, selected); } catch (e) { notify('Request saved, but an attachment could not upload. Open the request and attach it in a message.'); }
  await requestList(); await showThread(request); await alertEmail({ request });
});
form('reply-form', async () => {
  const request = activeRequest, selected = files($('reply-files'));
  await rpc('reply', { p_request: request, p_body: $('reply').value }); $('reply-form').reset(); notify('Message saved.');
  try { await upload(request, selected); } catch { notify('Message saved, but an attachment could not upload. Please attach it again in another message.'); }
  await showThread(request); await alertEmail({ request });
});
form('status-form', async () => { const request = activeRequest; await rpc('status', { p_request: request, p_status: $('status').value }); notify('Status updated.'); await requestList(); await showThread(request); await alertEmail({ request }); });
$('property').addEventListener('change', () => propertyView().catch(e => notify(e.message)));
$('signout').addEventListener('click', async () => { check(await db.auth.signOut()); profiles.clear(); $('thread').hidden = true; notify('Signed out.'); await loadApp(); });
$('export').addEventListener('click', async () => {
  if (!isManager(activeProperty)) return;
  try {
    const rows = check(await db.from('maintenance_tenants').select('user_id').eq('property_id', activeProperty.id)); await loadProfiles(rows.map(r => r.user_id));
    const csv = v => '"' + String(v ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"';
    const text = [['Property', 'Name', 'Email', 'Phone'], ...rows.map(r => [activeProperty.address, profiles.get(r.user_id)?.name || '', profiles.get(r.user_id)?.contact_email || profiles.get(r.user_id)?.email || '', profiles.get(r.user_id)?.phone || ''])].map(row => row.map(csv).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' })), link = element('a'); link.href = url; link.download = 'aplynx-property-contacts.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { notify(e.message); }
});
try {
  const res = await fetch('/api/maintenance'); if (!res.ok) throw new Error('Portal configuration unavailable');
  const config = await res.json();
  if (!config.ready) $('setup').hidden = false;
  else { db = createClient(config.url, config.key); await loadApp(); }
} catch { $('setup').hidden = false; }
