begin;
alter table public.maintenance_profiles add column contact_email text check(contact_email is null or (contact_email=lower(contact_email) and length(contact_email)<=254));
create table public.maintenance_admin_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id),
 action text not null, subject_id uuid, details jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table public.maintenance_admin_audit enable row level security;
revoke all on public.maintenance_admin_audit from public,anon,authenticated;
grant select,insert on public.maintenance_admin_audit to service_role;
grant select on public.maintenance_admins to service_role;
grant select,insert,update on public.maintenance_profiles to service_role;

-- Removing membership also removes access to old conversations and attachments.
create or replace function public.maintenance_can_read(r uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from maintenance_requests where id=r and
 (maintenance_manages(property_id) or (tenant_id=auth.uid() and maintenance_member(property_id))));
$$;
create or replace function public.maintenance_email_batch(p_request uuid default null,p_invite uuid default null)
returns table(notification_id uuid,email text,kind text,request_id uuid,invite_id uuid)
language sql security definer set search_path=public as $$
 select n.id,u.email::text,n.kind,n.request_id,n.invite_id from maintenance_notifications n join auth.users u on u.id=n.recipient_id
 join maintenance_requests r on r.id=n.request_id join maintenance_properties p on p.id=r.property_id
 where n.sent_at is null and (p_request is null or n.request_id=p_request) and (p_invite is null or n.invite_id=p_invite)
 and (n.recipient_id in (p.owner_id,p.manager_id) or exists(select 1 from maintenance_tenants t where t.property_id=p.id and t.user_id=n.recipient_id))
 order by n.created_at limit 50;
$$;

create function public.maintenance_admin_action(p_actor uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare target uuid; prop maintenance_properties; invitation maintenance_invites; result uuid; address text; account_email text;
begin
 if not exists(select 1 from auth.users u join maintenance_admins a on a.email=lower(u.email) where u.id=p_actor) then raise exception 'Administrator access required'; end if;
 if p_action='profile' then
  target:=(p_input->>'id')::uuid;
  select email into account_email from auth.users where id=target;
  if account_email is null then raise exception 'Account not found'; end if;
  address:=nullif(lower(trim(p_input->>'contact_email')),'');
  if address is not null and address !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid contact email'; end if;
  insert into maintenance_profiles(id,email,name,phone,contact_email) values(target,lower(account_email),trim(p_input->>'name'),coalesce(trim(p_input->>'phone'),''),address)
  on conflict(id) do update set name=excluded.name,phone=excluded.phone,contact_email=excluded.contact_email,email=excluded.email,updated_at=now();
 elsif p_action='invite' then
  select * into invitation from maintenance_invites where id=(p_input->>'id')::uuid for update;
  if invitation.id is null or invitation.accepted_at is not null then raise exception 'Only unaccepted invitations can be corrected or resent'; end if;
  address:=lower(trim(coalesce(p_input->>'email',invitation.email)));
  if address !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(address)>254 then raise exception 'Enter a valid email'; end if;
  if invitation.role='manager' and not exists(select 1 from maintenance_admins where email=address) then raise exception 'Manager must be an approved Aplynx administrator'; end if;
  if exists(select 1 from maintenance_invites where id<>invitation.id and property_id=invitation.property_id and email=address and role=invitation.role and accepted_at is null and expires_at>now()) then raise exception 'This address already has a pending invitation'; end if;
  update maintenance_invites set expires_at=now() where id=invitation.id;
  insert into maintenance_invites(property_id,email,role,invited_by) values(invitation.property_id,address,invitation.role,p_actor) returning id into result;
  target:=invitation.id;
 elsif p_action='cancel_invite' then
  target:=(p_input->>'id')::uuid;
  update maintenance_invites set expires_at=now() where id=target and accepted_at is null;
  if not found then raise exception 'Invitation unavailable'; end if;
 elsif p_action='remove' then
  target:=(p_input->>'id')::uuid;
  if target=p_actor then raise exception 'You cannot remove your own access here'; end if;
  select * into prop from maintenance_properties where id=(p_input->>'property')::uuid for update;
  if prop.id is null then raise exception 'Property not found'; end if;
  if prop.owner_id=target then
   if prop.manager_id is null or prop.manager_id=target then raise exception 'Assign another property contact before removing the owner'; end if;
   update maintenance_properties set owner_id=null,mode='aplynx' where id=prop.id;
  end if;
  if prop.manager_id=target then
   if prop.owner_id is null or prop.owner_id=target then raise exception 'Assign an owner before removing the manager'; end if;
   update maintenance_properties set manager_id=null,mode='self' where id=prop.id;
  end if;
  delete from maintenance_tenants where property_id=prop.id and user_id=target;
  update maintenance_invites set expires_at=now() where property_id=prop.id and accepted_at is null and email=(select lower(email) from auth.users where id=target);
  delete from maintenance_notifications n using maintenance_requests r where n.request_id=r.id and r.property_id=prop.id and n.recipient_id=target and n.sent_at is null;
 else raise exception 'Unknown action'; end if;
 insert into maintenance_admin_audit(actor_id,action,subject_id,details) values(p_actor,p_action,target,p_input);
 return jsonb_build_object('ok',true,'invite',result);
end $$;
revoke all on function public.maintenance_admin_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.maintenance_admin_action(uuid,text,jsonb) to service_role;

-- Keep the profile login address in step with verified Auth changes.
create function public.maintenance_sync_login_email() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update maintenance_profiles set email=lower(new.email),updated_at=now() where id=new.id;
 return new;
end $$;
revoke all on function public.maintenance_sync_login_email() from public,anon,authenticated;
create trigger maintenance_login_email_changed after update of email on auth.users for each row when (old.email is distinct from new.email) execute function public.maintenance_sync_login_email();
commit;
