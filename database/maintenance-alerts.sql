-- Additive maintenance alert preferences. Existing property and request RLS is preserved.
begin;
create table public.maintenance_alert_preferences (
 user_id uuid primary key references auth.users(id),
 channel text not null default 'email' check(channel in ('email','sms','both')),
 sms_phone text not null default '',
 sms_consent_at timestamptz,
 updated_at timestamptz not null default now(),
 check(channel='email' or (sms_phone ~ '^\+[1-9][0-9]{7,14}$' and sms_consent_at is not null))
);
alter table public.maintenance_alert_preferences enable row level security;
revoke all on public.maintenance_alert_preferences from public,anon,authenticated;
grant select on public.maintenance_alert_preferences to authenticated;
grant all on public.maintenance_alert_preferences to service_role;
create policy own_alert_preferences on public.maintenance_alert_preferences for select to authenticated using(user_id=(select auth.uid()));

create table public.maintenance_sms_deliveries (
 notification_id uuid primary key references public.maintenance_notifications(id),
 state text not null check(state in ('processing','accepted','failed','unknown')),
 provider_id text,
 attempts integer not null default 1,
 updated_at timestamptz not null default now()
);
alter table public.maintenance_sms_deliveries enable row level security;
revoke all on public.maintenance_sms_deliveries from public,anon,authenticated;
grant all on public.maintenance_sms_deliveries to service_role;

create schema if not exists aplynx_maintenance_private;
revoke all on schema aplynx_maintenance_private from public,anon;
grant usage on schema aplynx_maintenance_private to authenticated;

-- No caller can set another account's preference or choose a notification recipient.
create function aplynx_maintenance_private.save_alert_preferences(p_channel text,p_phone text,p_consent boolean)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); prior public.maintenance_alert_preferences; normalized text;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception 'Sign in with a verified email.'; end if;
 if p_channel is null or p_channel not in ('email','sms','both') then raise exception 'Choose email, text, or both.'; end if;
 normalized:=regexp_replace(coalesce(p_phone,''),'[^+0-9]','','g');
 if normalized ~ '^[0-9]{10}$' then normalized:='+1'||normalized; end if;
 if normalized ~ '^1[0-9]{10}$' then normalized:='+'||normalized; end if;
 if p_channel<>'email' and (coalesce(p_consent,false)=false or normalized !~ '^\+[1-9][0-9]{7,14}$') then raise exception 'Enter a mobile number with country code and agree to text alerts.'; end if;
 select * into prior from public.maintenance_alert_preferences where user_id=uid;
 insert into public.maintenance_alert_preferences(user_id,channel,sms_phone,sms_consent_at)
 values(uid,p_channel,case when p_channel='email' then '' else normalized end,
 case when p_channel='email' then null when prior.channel in ('sms','both') and prior.sms_phone=normalized then prior.sms_consent_at else now() end)
 on conflict(user_id) do update set channel=excluded.channel,sms_phone=excluded.sms_phone,sms_consent_at=excluded.sms_consent_at,updated_at=now();
end$$;
revoke all on function aplynx_maintenance_private.save_alert_preferences(text,text,boolean) from public,anon;
grant execute on function aplynx_maintenance_private.save_alert_preferences(text,text,boolean) to authenticated;
create function public.maintenance_save_alert_preferences(p_channel text,p_phone text,p_consent boolean)
returns void language sql security invoker set search_path='' as $$
 select aplynx_maintenance_private.save_alert_preferences(p_channel,p_phone,p_consent);
$$;
revoke all on function public.maintenance_save_alert_preferences(text,text,boolean) from public,anon;
grant execute on function public.maintenance_save_alert_preferences(text,text,boolean) to authenticated;

-- Only the server reads the outbox. Re-check request membership on every dispatch.
create function public.maintenance_alert_batch(p_request uuid default null)
returns table(notification_id uuid,email text,kind text,request_id uuid,email_pending boolean,sms_pending boolean)
language sql security definer set search_path='' as $$
 select n.id,u.email::text,n.kind,n.request_id,
  (n.sent_at is null and coalesce(a.channel,'email') in ('email','both')),
  (coalesce(a.channel,'email') in ('sms','both') and a.sms_consent_at<=n.created_at and
   (s.notification_id is null or (s.state='failed' and s.attempts<3 and s.updated_at<now()-interval '15 minutes')))
 from public.maintenance_notifications n join auth.users u on u.id=n.recipient_id
 join public.maintenance_requests r on r.id=n.request_id
 join public.maintenance_properties p on p.id=r.property_id
 left join public.maintenance_alert_preferences a on a.user_id=n.recipient_id
 left join public.maintenance_sms_deliveries s on s.notification_id=n.id
 where (p_request is null or n.request_id=p_request)
 and (n.recipient_id in (p.owner_id,p.manager_id) or
  (n.recipient_id=r.tenant_id and exists(select 1 from public.maintenance_tenants t where t.property_id=p.id and t.user_id=n.recipient_id)))
 and ((n.sent_at is null and coalesce(a.channel,'email') in ('email','both')) or
  (a.channel in ('sms','both') and a.sms_consent_at<=n.created_at and
   (s.notification_id is null or (s.state='failed' and s.attempts<3 and s.updated_at<now()-interval '15 minutes'))))
 order by n.created_at limit 50;
$$;
revoke all on function public.maintenance_alert_batch(uuid) from public,anon,authenticated;
grant execute on function public.maintenance_alert_batch(uuid) to service_role;

create function public.maintenance_claim_sms(p_notification uuid)
returns table(phone text) language plpgsql security definer set search_path='' as $$
declare target uuid; destination text; affected integer;
begin
 select n.recipient_id,a.sms_phone into target,destination from public.maintenance_notifications n
 join public.maintenance_alert_preferences a on a.user_id=n.recipient_id
 join public.maintenance_requests r on r.id=n.request_id join public.maintenance_properties p on p.id=r.property_id
 where n.id=p_notification and a.channel in ('sms','both') and a.sms_consent_at<=n.created_at
 and (n.recipient_id in (p.owner_id,p.manager_id) or (n.recipient_id=r.tenant_id and exists(select 1 from public.maintenance_tenants t where t.property_id=p.id and t.user_id=n.recipient_id)));
 if target is null then return; end if;
 perform pg_advisory_xact_lock(hashtextextended(target::text,0));
 if (select count(*) from public.maintenance_sms_deliveries d join public.maintenance_notifications n on n.id=d.notification_id where n.recipient_id=target and d.updated_at>now()-interval '1 day' and d.state in ('processing','accepted','unknown'))>=20 then return; end if;
 insert into public.maintenance_sms_deliveries(notification_id,state) values(p_notification,'processing')
 on conflict(notification_id) do update set state='processing',attempts=public.maintenance_sms_deliveries.attempts+1,updated_at=now()
 where public.maintenance_sms_deliveries.state='failed' and public.maintenance_sms_deliveries.attempts<3 and public.maintenance_sms_deliveries.updated_at<now()-interval '15 minutes';
 get diagnostics affected=row_count;
 if affected=1 then return query select destination; end if;
end$$;
revoke all on function public.maintenance_claim_sms(uuid) from public,anon,authenticated;
grant execute on function public.maintenance_claim_sms(uuid) to service_role;
commit;
