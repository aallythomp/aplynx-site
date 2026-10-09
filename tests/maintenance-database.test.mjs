// Run with PGLITE_MODULE pointing to an installed @electric-sql/pglite ESM entry.
// Exercises real PostgreSQL functions/RLS using minimal auth/storage test schemas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('real PostgreSQL routing, property invitations, request privacy, and storage RLS', { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE);
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('test.email',true))$$;
    grant usage on schema auth,storage,public to authenticated,anon;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text);
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to authenticated;
  `);
  await db.exec(await readFile(new URL('../supabase/maintenance.sql', import.meta.url), 'utf8'));
  const ids = Array.from({ length: 5 }, (_, i) => `00000000-0000-0000-0000-00000000000${i+1}`);
  const emails = ['allynthompson27@gmail.com','owner@example.com','tenant@example.com','other-tenant@example.com','stranger@example.com'];
  for (let i=0;i<ids.length;i++) await db.query('insert into auth.users values($1,$2)', [ids[i],emails[i]]);
  async function as(i) { await db.exec('reset role'); await db.query("select set_config('test.uid',$1,false),set_config('test.email',$2,false)",[ids[i],emails[i]]); await db.exec('set role authenticated'); }
  const rpc = async (name, args) => (await db.query(`select public.maintenance_${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args)).rows[0].value;
  async function denied(action) { await assert.rejects(action); }
  await as(0);
  const managed = await rpc('create_property',['Managed house','aplynx']);
  const ownerInvite = await rpc('invite',[managed,emails[1],'owner']);
  const tenantInvite = await rpc('invite',[managed,emails[2],'tenant']);
  const otherInvite = await rpc('invite',[managed,emails[3],'tenant']);
  await as(4); await denied(()=>rpc('accept_invite',[tenantInvite]));
  await as(1); await rpc('accept_invite',[ownerInvite]);
  const self = await rpc('create_property',['Owner managed house','self']);
  await denied(()=>rpc('create_property',['Unauthorized Aplynx house','aplynx']));
  const selfTenantInvite = await rpc('invite',[self,emails[2],'tenant']);
  await denied(()=>rpc('invite',[self,emails[4],'manager']));
  await as(2); await rpc('accept_invite',[tenantInvite]); await rpc('accept_invite',[selfTenantInvite]);
  await db.query('insert into maintenance_profiles(id,email,name,phone) values($1,$2,$3,$4)',[ids[2],emails[2],'Tenant','555-0100']);
  await denied(()=>db.query('update maintenance_profiles set email=$1 where id=$2',['fake@example.com',ids[2]]));
  const a = await rpc('submit',[managed,'Sink leak','The kitchen sink leaks','routine']);
  const b = await rpc('submit',[self,'Door lock','Door lock needs repair','urgent']);
  await denied(()=>db.query('update maintenance_properties set owner_id=$1 where id=$2',[ids[2],managed]));
  await db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['maintenance',`${a}/${ids[2]}/photo.jpg`,ids[2]]);
  await db.exec('reset role');
  const notices = (await db.query('select request_id,recipient_id from maintenance_notifications order by created_at')).rows;
  assert.equal(notices.find(n=>n.request_id===a).recipient_id, ids[0]);
  assert.equal(notices.find(n=>n.request_id===b).recipient_id, ids[1]);
  await as(3); await rpc('accept_invite',[otherInvite]);
  assert.equal((await db.query('select * from maintenance_requests')).rows.length, 0);
  assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
  await denied(()=>rpc('reply',[a,'Trying to see another tenant request']));
  await denied(()=>db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['maintenance',`${a}/${ids[3]}/bad.jpg`,ids[3]]));
  await as(4); assert.equal((await db.query('select * from maintenance_properties')).rows.length,0);
  await denied(()=>rpc('submit',[managed,'Invalid','Not a tenant','routine']));
  await as(1); assert.equal((await db.query('select * from maintenance_requests')).rows.length,2);
  assert.equal((await db.query('select * from maintenance_profiles')).rows[0].email,emails[2]);
  assert.equal((await db.query('select * from storage.objects')).rows.length,1);
  await rpc('reply',[a,'We will repair this tomorrow']); await rpc('status',[a,'in_progress']);
  await db.exec('reset role');
  const replies = (await db.query("select recipient_id from maintenance_notifications where kind in ('message','status')")).rows;
  assert.ok(replies.some(n=>n.recipient_id===ids[2]));
  assert.ok(replies.some(n=>n.recipient_id===ids[0]));
  assert.ok(replies.every(n=>[ids[0],ids[2]].includes(n.recipient_id)));
  await as(2); assert.equal((await db.query('select * from maintenance_messages')).rows.length,1);
  await denied(()=>rpc('status',[a,'resolved']));
  await as(1); await rpc('set_mode',[managed,'self']);
  await as(2); const c = await rpc('submit',[managed,'Window','Window does not close','routine']);
  await db.exec('reset role'); assert.equal((await db.query('select recipient_id from maintenance_notifications where request_id=$1',[c])).rows[0].recipient_id, ids[1]);
  await db.close();
});
