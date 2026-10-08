-- Apply once to a dedicated Supabase project. Never expose service_role in the browser.
begin;
create table public.maintenance_admins (email text primary key check(email=lower(email)));
-- Account verified in the existing Aplynx Client Hub. Change only after verifying identity.
insert into public.maintenance_admins values ('allynthompson27@gmail.com');
create table public.maintenance_profiles (
  id uuid primary key references auth.users(id), email text not null check(email=lower(email)), name text not null check(length(name) between 1 and 120),
  phone text not null default '' check(length(phone)<=40), updated_at timestamptz not null default now()
);
create table public.maintenance_properties (
  id uuid primary key default gen_random_uuid(), address text not null check(length(address) between 3 and 300),
  mode text not null check(mode in ('self','aplynx')), owner_id uuid references auth.users(id),
  manager_id uuid references auth.users(id), created_at timestamptz not null default now(),
  check((mode='self' and owner_id is not null) or (mode='aplynx' and manager_id is not null))
);
create table public.maintenance_tenants (
  property_id uuid references public.maintenance_properties(id), user_id uuid references auth.users(id),
  primary key(property_id,user_id)
);
create table public.maintenance_invites (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references public.maintenance_properties(id),
  email text not null check(email=lower(email) and length(email)<=254), role text not null check(role in ('tenant','owner','manager')),
  invited_by uuid not null references auth.users(id), expires_at timestamptz not null default now()+interval '7 days',
  accepted_at timestamptz, email_sent_at timestamptz, created_at timestamptz not null default now()
);
create table public.maintenance_requests (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references public.maintenance_properties(id),
  tenant_id uuid not null references auth.users(id), title text not null check(length(title) between 3 and 160),
  issue text not null check(length(issue) between 3 and 5000), urgency text not null check(urgency in ('routine','urgent')),
  status text not null default 'new' check(status in ('new','in_progress','resolved')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.maintenance_messages (
  id uuid primary key default gen_random_uuid(), request_id uuid not null references public.maintenance_requests(id),
  author_id uuid not null references auth.users(id), body text not null check(length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create table public.maintenance_notifications (
  id uuid primary key default gen_random_uuid(), recipient_id uuid not null references auth.users(id),
  request_id uuid references public.maintenance_requests(id), invite_id uuid references public.maintenance_invites(id),
  kind text not null check(kind in ('request','message','status','invite')), sent_at timestamptz,
  created_at timestamptz not null default now(), check(num_nonnulls(request_id,invite_id)=1)
);
create index on public.maintenance_requests(property_id,created_at desc);
create index on public.maintenance_messages(request_id,created_at);
create index on public.maintenance_notifications(created_at) where sent_at is null;
create index on public.maintenance_invites(email) where accepted_at is null;

create function public.maintenance_is_admin() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from maintenance_admins where email=lower(auth.jwt()->>'email'));
$$;
create function public.maintenance_manages(p uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from maintenance_properties where id=p and auth.uid() in (owner_id,manager_id));
$$;
create function public.maintenance_member(p uuid) returns boolean language sql stable security definer set search_path=public as $$
 select maintenance_manages(p) or exists(select 1 from maintenance_tenants where property_id=p and user_id=auth.uid());
$$;
create function public.maintenance_can_read(r uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from maintenance_requests where id=r and (tenant_id=auth.uid() or maintenance_manages(property_id)));
$$;

alter table public.maintenance_admins enable row level security;
alter table public.maintenance_profiles enable row level security;
alter table public.maintenance_properties enable row level security;
alter table public.maintenance_tenants enable row level security;
alter table public.maintenance_invites enable row level security;
alter table public.maintenance_requests enable row level security;
alter table public.maintenance_messages enable row level security;
alter table public.maintenance_notifications enable row level security;
create policy profile_read on public.maintenance_profiles for select to authenticated using (
 id=auth.uid() or exists(select 1 from maintenance_tenants t where t.user_id=maintenance_profiles.id and maintenance_manages(t.property_id))
 or exists(select 1 from maintenance_requests r where r.tenant_id=maintenance_profiles.id and maintenance_can_read(r.id))
 or exists(select 1 from maintenance_properties p where maintenance_profiles.id in (p.owner_id,p.manager_id) and maintenance_member(p.id))
);
create policy profile_insert on public.maintenance_profiles for insert to authenticated with check(id=auth.uid() and email=lower(auth.jwt()->>'email'));
create policy profile_update on public.maintenance_profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid() and email=lower(auth.jwt()->>'email'));
create policy property_read on public.maintenance_properties for select to authenticated using(maintenance_member(id));
create policy tenant_read on public.maintenance_tenants for select to authenticated using(user_id=auth.uid() or maintenance_manages(property_id));
create policy invite_read on public.maintenance_invites for select to authenticated using(
 maintenance_manages(property_id) or email=lower(auth.jwt()->>'email')
);
create policy request_read on public.maintenance_requests for select to authenticated using(maintenance_can_read(id));
create policy message_read on public.maintenance_messages for select to authenticated using(maintenance_can_read(request_id));
-- Writes to property permissions, requests and conversations go through validated RPCs only.
revoke all on public.maintenance_admins,public.maintenance_notifications from anon,authenticated;
grant select,insert,update on public.maintenance_profiles to authenticated;
grant select on public.maintenance_properties,public.maintenance_tenants,public.maintenance_invites,public.maintenance_requests,public.maintenance_messages to authenticated;

create function public.maintenance_create_property(p_address text,p_mode text) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_mode='aplynx' and not maintenance_is_admin() then raise exception 'Only Aplynx can register managed properties'; end if;
 insert into maintenance_properties(address,mode,owner_id,manager_id)
 values(trim(p_address),p_mode,case when p_mode='self' then auth.uid() end,case when p_mode='aplynx' then auth.uid() end) returning id into result;
 return result;
end $$;

create function public.maintenance_invite(p_property uuid,p_email text,p_role text) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid; prop maintenance_properties; recipient uuid;
begin
 select * into prop from maintenance_properties where id=p_property for update;
 if not maintenance_manages(p_property) then raise exception 'Property access required'; end if;
 p_email:=lower(trim(p_email));
 if p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email'; end if;
 if p_role='owner' and (prop.owner_id is not null or prop.manager_id is distinct from auth.uid()) then raise exception 'Owner already assigned'; end if;
 if p_role='manager' and (prop.owner_id is distinct from auth.uid() or not exists(select 1 from maintenance_admins where email=p_email)) then raise exception 'Only a verified Aplynx manager can manage this property'; end if;
 if exists(select 1 from maintenance_invites where property_id=p_property and email=p_email and role=p_role and accepted_at is null and expires_at>now()) then raise exception 'An invitation is already waiting for this email'; end if;
 insert into maintenance_invites(property_id,email,role,invited_by) values(p_property,p_email,p_role,auth.uid()) returning id into result;
 -- Invitation email is dispatched by the server after authorizing invited_by.
 return result;
end $$;

create function public.maintenance_accept_invite(p_invite uuid) returns void
language plpgsql security definer set search_path=public as $$
declare invitation maintenance_invites; prop maintenance_properties;
begin
 select * into invitation from maintenance_invites where id=p_invite for update;
 if invitation.id is null or invitation.email<>lower(coalesce(auth.jwt()->>'email','')) or auth.uid() is null
 or invitation.accepted_at is not null or invitation.expires_at<=now() then raise exception 'Invitation unavailable for this account'; end if;
 select * into prop from maintenance_properties where id=invitation.property_id for update;
 if invitation.role='owner' then
   if prop.owner_id is not null then raise exception 'Owner already assigned'; end if;
   update maintenance_properties set owner_id=auth.uid() where id=prop.id;
 elsif invitation.role='manager' then
   if not maintenance_is_admin() then raise exception 'Aplynx account required'; end if;
   update maintenance_properties set manager_id=auth.uid(),mode='aplynx' where id=prop.id;
 else
   insert into maintenance_tenants values(prop.id,auth.uid()) on conflict do nothing;
 end if;
 update maintenance_invites set accepted_at=now() where id=invitation.id;
end $$;

create function public.maintenance_set_mode(p_property uuid,p_mode text) returns void
language plpgsql security definer set search_path=public as $$
declare prop maintenance_properties;
begin
 select * into prop from maintenance_properties where id=p_property for update;
 if not maintenance_manages(p_property) then raise exception 'Property access required'; end if;
 if p_mode='aplynx' and prop.manager_id is null then raise exception 'Invite Aplynx and wait for acceptance first'; end if;
 if p_mode='self' and prop.owner_id is null then raise exception 'Invite the owner and wait for acceptance first'; end if;
 update maintenance_properties set mode=p_mode where id=p_property;
end $$;

create function public.maintenance_notify(p_request uuid,p_kind text,p_author uuid) returns void
language plpgsql security definer set search_path=public as $$
declare r maintenance_requests; p maintenance_properties; target uuid;
begin
 select * into r from maintenance_requests where id=p_request;
 select * into p from maintenance_properties where id=r.property_id;
 -- New requests go FIRST to the active manager, exactly as specified.
 target:=case when p.mode='aplynx' then p.manager_id else p.owner_id end;
 if p_kind='request' then
   if target<>p_author then insert into maintenance_notifications(recipient_id,request_id,kind) values(target,p_request,p_kind); end if;
 else
   -- Later updates alert the tenant, owner and active manager, excluding the sender.
   for target in select distinct participant from unnest(array[r.tenant_id,p.owner_id,case when p.mode='aplynx' then p.manager_id end]) participant
     where participant is not null and participant<>p_author loop
     insert into maintenance_notifications(recipient_id,request_id,kind) values(target,p_request,p_kind);
   end loop;
 end if;
end $$;
revoke all on function public.maintenance_notify(uuid,text,uuid) from public,anon,authenticated;

create function public.maintenance_submit(p_property uuid,p_title text,p_issue text,p_urgency text) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 if auth.uid() is null or not maintenance_member(p_property) then raise exception 'Property access required'; end if;
 if not exists(select 1 from maintenance_profiles where id=auth.uid()) then raise exception 'Save your contact information first'; end if;
 insert into maintenance_requests(property_id,tenant_id,title,issue,urgency)
 values(p_property,auth.uid(),trim(p_title),trim(p_issue),p_urgency) returning id into result;
 perform maintenance_notify(result,'request',auth.uid());
 return result;
end $$;
create function public.maintenance_reply(p_request uuid,p_body text) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 if not maintenance_can_read(p_request) then raise exception 'Request access required'; end if;
 insert into maintenance_messages(request_id,author_id,body) values(p_request,auth.uid(),trim(p_body)) returning id into result;
 update maintenance_requests set updated_at=now() where id=p_request;
 perform maintenance_notify(p_request,'message',auth.uid());
 return result;
end $$;
create function public.maintenance_status(p_request uuid,p_status text) returns void
language plpgsql security definer set search_path=public as $$
declare r maintenance_requests;
begin
 select * into r from maintenance_requests where id=p_request for update;
 if not maintenance_manages(r.property_id) then raise exception 'Manager access required'; end if;
 if r.status=p_status then return; end if;
 update maintenance_requests set status=p_status,updated_at=now() where id=p_request;
 perform maintenance_notify(p_request,'status',auth.uid());
end $$;

-- Notification endpoint obtains addresses server-side, never trusting a client recipient.
create function public.maintenance_email_batch(p_request uuid default null,p_invite uuid default null)
returns table(notification_id uuid,email text,kind text,request_id uuid,invite_id uuid)
language sql security definer set search_path=public as $$
 select n.id,u.email::text,n.kind,n.request_id,n.invite_id from maintenance_notifications n join auth.users u on u.id=n.recipient_id
 where n.sent_at is null and (p_request is null or n.request_id=p_request) and (p_invite is null or n.invite_id=p_invite)
 order by n.created_at limit 50;
$$;
revoke all on function public.maintenance_email_batch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.maintenance_email_batch(uuid,uuid) to service_role;

-- Explicit grants prevent default PUBLIC RPC execution.
revoke all on function public.maintenance_is_admin(),public.maintenance_manages(uuid),public.maintenance_member(uuid),public.maintenance_can_read(uuid),
 public.maintenance_create_property(text,text),public.maintenance_invite(uuid,text,text),public.maintenance_accept_invite(uuid),public.maintenance_set_mode(uuid,text),
 public.maintenance_submit(uuid,text,text,text),public.maintenance_reply(uuid,text),public.maintenance_status(uuid,text) from public,anon;
grant execute on function public.maintenance_is_admin(),public.maintenance_manages(uuid),public.maintenance_member(uuid),public.maintenance_can_read(uuid),
 public.maintenance_create_property(text,text),public.maintenance_invite(uuid,text,text),public.maintenance_accept_invite(uuid),public.maintenance_set_mode(uuid,text),
 public.maintenance_submit(uuid,text,text,text),public.maintenance_reply(uuid,text),public.maintenance_status(uuid,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('maintenance','maintenance',false,26214400,array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']);
create function public.maintenance_file_access(path text) returns boolean language plpgsql stable security definer set search_path=public as $$
begin
 return maintenance_can_read(split_part(path,'/',1)::uuid);
exception when invalid_text_representation then return false;
end $$;
revoke all on function public.maintenance_file_access(text) from public,anon;
grant execute on function public.maintenance_file_access(text) to authenticated;
create policy maintenance_file_read on storage.objects for select to authenticated using(bucket_id='maintenance' and maintenance_file_access(name));
create policy maintenance_file_insert on storage.objects for insert to authenticated with check(
 bucket_id='maintenance' and maintenance_file_access(name) and split_part(name,'/',2)=auth.uid()::text
);
create policy maintenance_file_delete on storage.objects for delete to authenticated using(
 bucket_id='maintenance' and owner_id=auth.uid()::text and maintenance_file_access(name)
);
do $$begin
 if to_regprocedure('public.rls_auto_enable()') is not null then
   execute 'revoke execute on function public.rls_auto_enable() from public,anon,authenticated';
 end if;
end$$;
create index if not exists maintenance_properties_owner_idx on public.maintenance_properties(owner_id);
create index if not exists maintenance_properties_manager_idx on public.maintenance_properties(manager_id);
create index if not exists maintenance_tenants_user_idx on public.maintenance_tenants(user_id);
create index if not exists maintenance_invites_property_idx on public.maintenance_invites(property_id);
create index if not exists maintenance_invites_inviter_idx on public.maintenance_invites(invited_by);
create index if not exists maintenance_requests_tenant_idx on public.maintenance_requests(tenant_id);
create index if not exists maintenance_messages_author_idx on public.maintenance_messages(author_id);
create index if not exists maintenance_notifications_recipient_idx on public.maintenance_notifications(recipient_id);
create index if not exists maintenance_notifications_request_idx on public.maintenance_notifications(request_id);
create index if not exists maintenance_notifications_invite_idx on public.maintenance_notifications(invite_id);
alter policy profile_read on public.maintenance_profiles using (
 id=(select auth.uid()) or exists(select 1 from maintenance_tenants t where t.user_id=maintenance_profiles.id and maintenance_manages(t.property_id))
 or exists(select 1 from maintenance_requests r where r.tenant_id=maintenance_profiles.id and maintenance_can_read(r.id))
 or exists(select 1 from maintenance_properties p where maintenance_profiles.id in (p.owner_id,p.manager_id) and maintenance_member(p.id))
);
alter policy profile_insert on public.maintenance_profiles with check(id=(select auth.uid()) and email=lower((select auth.jwt())->>'email'));
alter policy profile_update on public.maintenance_profiles using(id=(select auth.uid())) with check(id=(select auth.uid()) and email=lower((select auth.jwt())->>'email'));
alter policy tenant_read on public.maintenance_tenants using(user_id=(select auth.uid()) or maintenance_manages(property_id));
alter policy invite_read on public.maintenance_invites using(maintenance_manages(property_id) or email=lower((select auth.jwt())->>'email'));
grant select,insert,update,delete on public.maintenance_notifications,public.maintenance_invites to service_role;
commit;
