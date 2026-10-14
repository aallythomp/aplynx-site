alter table public.rental_listings add column if not exists owner_token_hash text;
alter table public.rental_listings add column if not exists notification_sent boolean not null default false;
alter table public.rental_listings add column if not exists completed_at timestamptz;
alter table public.rental_listings add column if not exists review_note text not null default '';
create table if not exists public.rental_listing_photos(listing_id uuid not null references public.rental_listings(id),object_path text primary key,uploaded boolean not null default false,created_at timestamptz not null default now());
create index if not exists rental_listing_photos_listing_idx on public.rental_listing_photos(listing_id);
alter table public.rental_listing_photos enable row level security;
create table if not exists public.rental_checkout_orders(id uuid primary key default gen_random_uuid(),listing_id uuid not null unique references public.rental_listings(id),tier text not null check(tier in ('featured','premium')),created_at timestamptz not null default now());
alter table public.rental_checkout_orders enable row level security;
create table if not exists public.rental_stripe_events(id text primary key,event_type text not null,created_at timestamptz not null default now());
alter table public.rental_stripe_events enable row level security;
create table if not exists public.rental_payment_reviews(stripe_session_id text primary key,reason text not null,created_at timestamptz not null default now());
alter table public.rental_payment_reviews enable row level security;
revoke all on public.rental_listing_photos,public.rental_checkout_orders,public.rental_stripe_events,public.rental_payment_reviews from anon,authenticated;
grant all on public.rental_listings,public.rental_promotions,public.rental_listing_photos,public.rental_checkout_orders,public.rental_stripe_events,public.rental_payment_reviews to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('aplynx-listing-photos','aplynx-listing-photos',false,2097152,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create or replace function public.reserve_rental_photo(p_listing uuid,p_path text) returns boolean language plpgsql security invoker set search_path='' as $$
declare l public.rental_listings;
begin
 select * into l from public.rental_listings where id=p_listing for update;
 if not found or l.completed_at is not null or l.status<>'pending' then return false; end if;
 if (select count(*) from public.rental_listing_photos where listing_id=p_listing)>=12 then return false; end if;
 insert into public.rental_listing_photos(listing_id,object_path) values(p_listing,p_path);
 return true;
end;$$;
revoke all on function public.reserve_rental_photo(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_rental_photo(uuid,text) to service_role;
create or replace function public.fulfill_rental_payment(p_event text,p_type text,p_order uuid,p_session text,p_intent text,p_tier text,p_amount int,p_paid_at timestamptz) returns text language plpgsql security invoker set search_path='' as $$
declare o public.rental_checkout_orders; l public.rental_listings;
begin
 insert into public.rental_stripe_events(id,event_type) values(p_event,p_type) on conflict do nothing;
 if not found then return 'already_processed'; end if;
 select * into o from public.rental_checkout_orders where id=p_order for update;
 if not found or o.tier<>p_tier or p_amount<>(case when p_tier='featured' then 1999 when p_tier='premium' then 3999 else 0 end) then
 insert into public.rental_payment_reviews values(p_session,'Payment does not match an APLYNX listing order',now()) on conflict do nothing; return 'needs_review'; end if;
 select * into l from public.rental_listings where id=o.listing_id for update;
 if l.status<>'approved' or l.published_at is null then
 insert into public.rental_payment_reviews values(p_session,'Listing is no longer approved for publication',now()) on conflict do nothing; return 'needs_review'; end if;
 if exists(select 1 from public.rental_promotions where stripe_checkout_session_id=p_session) then return 'already_fulfilled'; end if;
 if exists(select 1 from public.rental_promotions where listing_id=l.id and payment_status='paid' and ends_at>now()) then
 insert into public.rental_payment_reviews values(p_session,'Additional payment for an already active listing promotion; review for refund',now()) on conflict do nothing; return 'needs_review'; end if;
 insert into public.rental_promotions(listing_id,tier,stripe_checkout_session_id,stripe_payment_intent_id,amount_cents,payment_status,starts_at,ends_at)
 values(l.id,p_tier,p_session,p_intent,p_amount,'paid',p_paid_at,p_paid_at+interval '30 days');
 return 'fulfilled';
end;$$;
revoke all on function public.fulfill_rental_payment(text,text,uuid,text,text,text,int,timestamptz) from public,anon,authenticated;
grant execute on function public.fulfill_rental_payment(text,text,uuid,text,text,text,int,timestamptz) to service_role;
create or replace view public.aplynx_public_rentals as
 select l.id,l.property_type,l.city,l.state,l.postal_code,l.monthly_rent,l.deposit,l.bedrooms,l.bathrooms,l.available_on,l.description,l.photo_urls,l.application_url,l.published_at,
 coalesce(p.tier,'basic') as promotion_tier,p.ends_at as promotion_ends_at
 from public.rental_listings l left join lateral(select tier,ends_at from public.rental_promotions p where p.listing_id=l.id and p.payment_status='paid' and p.starts_at<=now() and p.ends_at>now() order by p.ends_at desc limit 1)p on true
 where l.status='approved' and l.published_at is not null;
revoke all on public.aplynx_public_rentals from anon,authenticated;
grant select on public.aplynx_public_rentals to service_role;
