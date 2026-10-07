begin;
create table if not exists public.listing_admins(user_id uuid primary key references auth.users(id));
alter table public.listing_admins enable row level security;
revoke all on public.listing_admins from anon, authenticated;
grant select on public.listing_admins to authenticated;
create policy "admins can see own membership" on public.listing_admins for select to authenticated using(user_id=auth.uid());
create function public.is_listing_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.listing_admins where user_id=auth.uid())$$;
create table public.customer_listings(
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id),
 title text not null check(length(title) between 3 and 120), rental_type text not null check(rental_type in ('Room','House','Apartment')),
 city text not null check(length(city) between 2 and 100), rent numeric not null check(rent>0 and rent<=100000),
 deposit numeric not null check(deposit>=0 and deposit<=100000), description text not null check(length(description) between 10 and 5000),
 bathroom text not null check(bathroom in ('Shared','Private')), status text not null default 'draft' check(status in ('draft','pending','approved','rejected')),
 created_at timestamptz not null default now(),submitted_at timestamptz, reviewed_at timestamptz,review_note text
);
alter table public.customer_listings enable row level security;
revoke all on public.customer_listings from anon,authenticated;
grant select on public.customer_listings to anon,authenticated;
grant insert(title,rental_type,city,rent,deposit,description,bathroom) on public.customer_listings to authenticated;
create policy "public sees approved only" on public.customer_listings for select to anon,authenticated using(status='approved');
create policy "owners see their listings" on public.customer_listings for select to authenticated using(owner_id=auth.uid());
create policy "admins see review queue" on public.customer_listings for select to authenticated using(public.is_listing_admin());
create policy "owners create draft only" on public.customer_listings for insert to authenticated with check(owner_id=auth.uid() and status='draft');
create table public.listing_photos(id uuid primary key default gen_random_uuid(),listing_id uuid not null references public.customer_listings(id),path text not null unique,position integer not null check(position between 0 and 9));
alter table public.listing_photos enable row level security;
revoke all on public.listing_photos from anon,authenticated;
grant select on public.listing_photos to anon,authenticated;
grant insert(listing_id,path,position) on public.listing_photos to authenticated;
create policy "visible listing photos" on public.listing_photos for select to anon,authenticated using(exists(select 1 from public.customer_listings l where l.id=listing_id));
create policy "owner draft photo metadata" on public.listing_photos for insert to authenticated with check(
 exists(select 1 from public.customer_listings l where l.id=listing_id and l.owner_id=auth.uid() and l.status='draft')
 and split_part(path,'/',1)=auth.uid()::text and split_part(path,'/',2)=listing_id::text
 and exists(select 1 from storage.objects where bucket_id='listing-photos' and name=path));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('listing-photos','listing-photos',false,10485760,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy "upload photos to owned draft" on storage.objects for insert to authenticated with check(bucket_id='listing-photos' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.customer_listings l where l.id::text=(storage.foldername(name))[2] and l.owner_id=auth.uid() and l.status='draft'));
create policy "read owned or approved listing photos" on storage.objects for select to anon,authenticated using(bucket_id='listing-photos' and exists(select 1 from public.customer_listings l where l.id::text=(storage.foldername(name))[2] and (l.status='approved' or l.owner_id=auth.uid() or public.is_listing_admin())));
create function public.submit_customer_listing(listing_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.customer_listings where id=listing_id and owner_id=auth.uid() and status='draft') then raise exception 'Listing is not an owned draft'; end if;
 if not exists(select 1 from public.listing_photos where listing_photos.listing_id=submit_customer_listing.listing_id) then raise exception 'Add at least one photo'; end if;
 update public.customer_listings set status='pending',submitted_at=now() where id=listing_id and owner_id=auth.uid() and status='draft';
end$$;
create function public.review_customer_listing(listing_id uuid,decision text,note text default '') returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_listing_admin() then raise exception 'Admin access required'; end if;
 if decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
 update public.customer_listings set status=decision,review_note=left(note,1000),reviewed_at=now() where id=listing_id and status='pending';
 if not found then raise exception 'Listing is no longer pending'; end if;
end$$;
revoke all on function public.is_listing_admin(),public.submit_customer_listing(uuid),public.review_customer_listing(uuid,text,text) from public;
grant execute on function public.is_listing_admin() to anon,authenticated;
grant execute on function public.submit_customer_listing(uuid),public.review_customer_listing(uuid,text,text) to authenticated;
commit;
-- Assign Allyn's VERIFIED account ID to listing_admins through a trusted database operation.
-- Customers have no privileges to change approval status, ownership, or admin membership.
