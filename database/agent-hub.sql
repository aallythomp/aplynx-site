-- APLYNX Agent Hub: additive schema; existing CRM/maintenance data is untouched.
create schema if not exists aplynx_hub_private;
revoke all on schema aplynx_hub_private from public,anon,authenticated;
create table if not exists aplynx_hub_private.admins(user_id uuid primary key references auth.users(id));
alter table aplynx_hub_private.admins enable row level security;
insert into aplynx_hub_private.admins values ('890a102e-2878-4d2e-a1c0-08fee77c51ac'),('403cbbd9-8d74-4c0a-89da-a0fa1d04aa24') on conflict do nothing;
create or replace function aplynx_hub_private.is_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from aplynx_hub_private.admins where user_id=auth.uid())$$;
create table if not exists public.agent_hub_profiles(
 user_id uuid primary key references auth.users(id),name text not null,email text not null,phone text not null,license_number text not null,brokerage text not null,broker_email text not null,areas text not null,
 license_until date,broker_authorized boolean not null default false,screening_until date,screening_reference text not null default '',review_note text not null default '',updated_at timestamptz not null default now());
create table if not exists public.agent_hub_settings(id boolean primary key default true check(id),booking_fee_cents integer not null default 700 check(booking_fee_cents=700),launch_approved boolean not null default false,approval_reference text not null default '');
insert into public.agent_hub_settings(id) values(true) on conflict do nothing;
create table if not exists public.agent_hub_jobs(
 id uuid primary key,requester_id uuid not null references auth.users(id),agent_id uuid references auth.users(id),address text not null,city text not null,postal text not null,showing_at timestamptz not null,offered_cents integer not null check(offered_cents between 1000 and 100000),booking_fee_cents integer not null default 700 check(booking_fee_cents=700),notes text not null default '',status text not null default 'pending' check(status in ('pending','open','accepted','completion_reported','completed','cancelled')),feedback text not null default '',payment_state text not null default 'not_collected',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists agent_hub_jobs_requester on public.agent_hub_jobs(requester_id);
create index if not exists agent_hub_jobs_agent on public.agent_hub_jobs(agent_id);
create table if not exists public.agent_hub_push(user_id uuid not null references auth.users(id),endpoint text primary key,p256dh text not null,auth text not null,created_at timestamptz not null default now());
create table if not exists public.agent_hub_events(id bigint generated always as identity primary key,job_id uuid references public.agent_hub_jobs(id),actor uuid not null,action text not null,created_at timestamptz not null default now());
alter table public.agent_hub_profiles enable row level security;
alter table public.agent_hub_settings enable row level security;
alter table public.agent_hub_jobs enable row level security;
alter table public.agent_hub_push enable row level security;
alter table public.agent_hub_events enable row level security;
revoke all on public.agent_hub_profiles,public.agent_hub_settings,public.agent_hub_jobs,public.agent_hub_push,public.agent_hub_events from anon,authenticated;
-- The UI uses bounded, authenticated RPCs, never direct table grants.
create or replace function aplynx_hub_private.eligible(uid uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.agent_hub_profiles p where p.user_id=uid and p.license_until>=current_date and p.broker_authorized and p.screening_until>=current_date and p.screening_reference<>'')$$;
create or replace function public.agent_hub_dashboard() returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); admin boolean; result jsonb;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception 'Sign in with a verified email address.';end if;
 admin:=aplynx_hub_private.is_admin();
 select jsonb_build_object('admin',admin,'eligible',aplynx_hub_private.eligible(uid),'profile',(select to_jsonb(p) from public.agent_hub_profiles p where user_id=uid),'settings',(select to_jsonb(s) from public.agent_hub_settings s where id=true),
 'profiles',case when admin then coalesce((select jsonb_agg(to_jsonb(p) order by updated_at desc) from (select * from public.agent_hub_profiles limit 250)p),'[]'::jsonb) else '[]'::jsonb end,
 'jobs',coalesce((select jsonb_agg(to_jsonb(j) order by created_at desc) from (select * from public.agent_hub_jobs where admin or requester_id=uid or agent_id=uid order by created_at desc limit 100)j),'[]'::jsonb),
 'counterparts',coalesce((select jsonb_agg(jsonb_build_object('user_id',p.user_id,'name',p.name,'email',p.email,'phone',p.phone,'brokerage',p.brokerage)) from public.agent_hub_profiles p where exists(select 1 from public.agent_hub_jobs j where (j.requester_id=uid and j.agent_id=p.user_id) or (j.agent_id=uid and j.requester_id=p.user_id))),'[]'::jsonb),
 'available',case when aplynx_hub_private.eligible(uid) then coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'city',j.city,'postal',j.postal,'showing_at',j.showing_at,'offered_cents',j.offered_cents)) from (select * from public.agent_hub_jobs where status='open' and showing_at>now() and requester_id<>uid order by showing_at limit 100)j),'[]'::jsonb) else '[]'::jsonb end) into result;
 return result;
end$$;
create or replace function public.agent_hub_action(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); admin boolean; j public.agent_hub_jobs; old public.agent_hub_profiles; jid uuid; count integer; em text;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception 'Sign in with a verified email address.';end if;
 admin:=aplynx_hub_private.is_admin();select email into em from auth.users where id=uid;
 if p_action='profile' then
 if length(p_data->>'name') not between 2 and 150 or (p_data->>'license_number')!~'^[0-9]{6}$' or length(p_data->>'brokerage') not between 2 and 150 or coalesce(p_data->>'broker_email','')!~'^[^ @]+@[^ @]+\.[^ @]+$' or length(p_data->>'phone') not between 7 and 40 or length(p_data->>'areas') not between 2 and 500 then raise exception 'Enter your name, six-digit Georgia license, brokerage, broker email, phone and service areas.';end if;
 select * into old from public.agent_hub_profiles where user_id=uid;
 insert into public.agent_hub_profiles(user_id,name,email,phone,license_number,brokerage,broker_email,areas) values(uid,p_data->>'name',em,p_data->>'phone',p_data->>'license_number',p_data->>'brokerage',p_data->>'broker_email',p_data->>'areas') on conflict(user_id) do update set name=excluded.name,phone=excluded.phone,license_number=excluded.license_number,brokerage=excluded.brokerage,broker_email=excluded.broker_email,areas=excluded.areas,updated_at=now(),license_until=case when old.license_number=excluded.license_number and old.name=excluded.name then old.license_until else null end,broker_authorized=case when old.brokerage=excluded.brokerage and old.broker_email=excluded.broker_email then old.broker_authorized else false end,screening_until=case when old.name=excluded.name then old.screening_until else null end;
 elsif p_action='request' then
 if not exists(select 1 from public.agent_hub_profiles where user_id=uid) then raise exception 'Save your agent profile first.';end if;
 jid:=(p_data->>'id')::uuid;
 if exists(select 1 from public.agent_hub_jobs where id=jid and requester_id=uid) then return jsonb_build_object('ok',true,'id',jid);end if;
 if coalesce((p_data->>'authorized')::boolean,false)=false or length(p_data->>'address') not between 5 and 300 or length(p_data->>'city') not between 2 and 100 or (p_data->>'postal')!~'^[0-9]{5}$' or (p_data->>'showing_at')::timestamptz<=now() or (p_data->>'showing_at')::timestamptz>now()+interval '90 days' or length(coalesce(p_data->>'notes',''))>2000 then raise exception 'Add valid property details and a future appointment within 90 days, and confirm authorization.';end if;
 if (select count(*) from public.agent_hub_jobs where requester_id=uid and created_at>now()-interval '1 day')>=10 then raise exception 'Daily request limit reached. Contact APLYNX for assistance.';end if;
 insert into public.agent_hub_jobs(id,requester_id,address,city,postal,showing_at,offered_cents,notes) values(jid,uid,p_data->>'address',p_data->>'city',p_data->>'postal',(p_data->>'showing_at')::timestamptz,(p_data->>'offered_cents')::integer,coalesce(p_data->>'notes',''));
 elsif p_action='suspend' then
 if not admin then raise exception 'Administrator access required.';end if;
 update public.agent_hub_profiles set license_until=null,broker_authorized=false,screening_until=null,review_note='Access paused by APLYNX; any required notices and review are handled separately.',updated_at=now() where user_id=(p_data->>'user_id')::uuid;
 elsif p_action='screening_review' then
 if not admin then raise exception 'Administrator access required.';end if;
 if length(coalesce(p_data->>'reference',''))<8 or length(coalesce(p_data->>'reference',''))>500 or (p_data->>'license_until')::date<current_date or (p_data->>'screening_until')::date<current_date or (p_data->>'screening_until')::date>current_date+366 or coalesce((p_data->>'human_reviewed')::boolean,false)=false then raise exception 'Document the verified license, broker authorization and provider review reference. A human must complete the review; do not enter criminal records here.';end if;
 update public.agent_hub_profiles set license_until=(p_data->>'license_until')::date,screening_until=(p_data->>'screening_until')::date,screening_reference=p_data->>'reference',broker_authorized=coalesce((p_data->>'broker_authorized')::boolean,false),review_note='Human-reviewed external screening and broker authorization; report retained with screening provider.',updated_at=now() where user_id=(p_data->>'user_id')::uuid;
 elsif p_action='launch' then
 if not admin or length(coalesce(p_data->>'reference',''))<8 then raise exception 'Record the broker/legal approval reference before activating jobs.';end if;
 update public.agent_hub_settings set launch_approved=coalesce((p_data->>'approved')::boolean,false),approval_reference=left(p_data->>'reference',500) where id=true;
 else
 jid:=(p_data->>'id')::uuid;select * into j from public.agent_hub_jobs where id=jid for update;
 if j.id is null then raise exception 'Showing request not found.';end if;
 if p_action='publish' then
 if not admin or j.status<>'pending' then raise exception 'Only an administrator can publish pending requests.';end if;
 if not (select launch_approved from public.agent_hub_settings where id=true) then raise exception 'Broker/legal launch approval is still pending.';end if;
 if not exists(select 1 from public.agent_hub_profiles where user_id=j.requester_id and license_until>=current_date and broker_authorized) then raise exception 'Verify the requesting agent license and broker authorization first.';end if;
 update public.agent_hub_jobs set status='open',updated_at=now() where id=jid;
 elsif p_action='claim' then
 if not (select launch_approved from public.agent_hub_settings where id=true) or not aplynx_hub_private.eligible(uid) then raise exception 'Current license, broker authorization and human-approved background screening are required.';end if;
 if j.requester_id=uid then raise exception 'You cannot claim your own request.';end if;
 update public.agent_hub_jobs set agent_id=uid,status='accepted',updated_at=now() where id=jid and status='open' and agent_id is null and showing_at>now();get diagnostics count=row_count;
 if count=0 then raise exception 'This job has already been claimed or is no longer available.';end if;
 elsif p_action='report' then
 if j.agent_id<>uid or j.status<>'accepted' or j.showing_at>now() or length(coalesce(p_data->>'feedback','')) not between 5 and 2000 then raise exception 'Only the assigned agent can report a completed appointment with feedback after its scheduled start.';end if;
 update public.agent_hub_jobs set status='completion_reported',feedback=p_data->>'feedback',updated_at=now() where id=jid;
 elsif p_action='confirm' then
 if (j.requester_id<>uid and not admin) or j.status<>'completion_reported' then raise exception 'The requesting agent or APLYNX must confirm the completion report.';end if;
 update public.agent_hub_jobs set status='completed',updated_at=now() where id=jid;
 elsif p_action='cancel' then
 if (j.requester_id<>uid and not admin) or j.status not in ('pending','open','accepted') then raise exception 'Only the requester or administrator can cancel an active request.';end if;
 update public.agent_hub_jobs set status='cancelled',updated_at=now() where id=jid;
 else raise exception 'Unknown action.';end if;
 end if;
 insert into public.agent_hub_events(job_id,actor,action) values(jid,uid,p_action);
 return jsonb_build_object('ok',true,'id',jid);
end$$;
create or replace function public.agent_hub_subscription(p_subscription jsonb) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();endpoint text:=p_subscription->>'endpoint';begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception 'Sign in with a verified email address.';end if;
 if endpoint !~ '^https://(fcm.googleapis.com/|updates.push.services.mozilla.com/|[a-zA-Z0-9.-]+\.push.apple.com/)' or length(endpoint)>2000 or length(p_subscription#>>'{keys,p256dh}') not between 40 and 200 or length(p_subscription#>>'{keys,auth}') not between 10 and 100 then raise exception 'Unsupported notification subscription.';end if;
 if exists(select 1 from public.agent_hub_push where agent_hub_push.endpoint=agent_hub_subscription.endpoint and user_id<>uid) then raise exception 'This browser is subscribed to another account. Unsubscribe first.';end if;
 if (select count(*) from public.agent_hub_push where user_id=uid)>=5 and not exists(select 1 from public.agent_hub_push where agent_hub_push.endpoint=agent_hub_subscription.endpoint and user_id=uid) then raise exception 'Device limit reached.';end if;
 insert into public.agent_hub_push(user_id,endpoint,p256dh,auth) values(uid,endpoint,p_subscription#>>'{keys,p256dh}',p_subscription#>>'{keys,auth}') on conflict(endpoint) do nothing;
end$$;
create or replace function public.agent_hub_unsubscribe(p_endpoint text) returns void language sql security definer set search_path='' as $$delete from public.agent_hub_push where user_id=auth.uid() and endpoint=p_endpoint$$;
create or replace function public.agent_hub_notify_targets(p_job uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or not aplynx_hub_private.is_admin() then raise exception 'Administrator access required.';end if;
 if not exists(select 1 from public.agent_hub_jobs where id=p_job and status='open') then raise exception 'Job is no longer open.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth))) from public.agent_hub_push s where aplynx_hub_private.eligible(s.user_id) and s.user_id<>(select requester_id from public.agent_hub_jobs where id=p_job)),'[]'::jsonb);
end$$;
revoke all on function public.agent_hub_dashboard(),public.agent_hub_action(text,jsonb),public.agent_hub_subscription(jsonb),public.agent_hub_unsubscribe(text),public.agent_hub_notify_targets(uuid) from public,anon;
grant execute on function public.agent_hub_dashboard(),public.agent_hub_action(text,jsonb),public.agent_hub_subscription(jsonb),public.agent_hub_unsubscribe(text),public.agent_hub_notify_targets(uuid) to authenticated;
