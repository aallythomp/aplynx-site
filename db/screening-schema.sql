-- Private payment ledger. This does not contain credit/background reports.
create table if not exists public.rental_screening_payments (
 stripe_session_id text primary key,
 stripe_payment_intent_id text not null unique,
 applicant_email text not null,
 applicant_name text not null default '',
 property_code text not null check (property_code = 'ruby-court-room-3'),
 amount_cents integer not null check (amount_cents = 7900),
 paid_at timestamptz not null,
 status text not null default 'awaiting_screening_invitation'
   check (status in ('awaiting_screening_invitation','invited','completed','refunded')),
 checkr_order_id text unique,
 created_at timestamptz not null default now()
);
alter table public.rental_screening_payments enable row level security;
revoke all on public.rental_screening_payments from public, anon, authenticated;
grant select, insert, update on public.rental_screening_payments to service_role;
