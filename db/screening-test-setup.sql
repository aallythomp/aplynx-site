-- TEST STAGING ONLY. Apply to a existing APLYNX database; this table is reserved for synthetic tests; never copy real applicants.
create table public.screening_test_applications (
 id uuid primary key,
 token_hash text not null,
 payment_reference text not null,
 stripe_payment_link_id text not null,
 applicant jsonb not null,
 property jsonb not null,
 amount_cents integer not null check (amount_cents = 7900),
 terms_version text not null,
 terms_accepted_at timestamptz,
 status text not null check (status in ('invited','checkout_created','ordering','waiting_for_applicant','pending','completed','canceled','needs_review')),
 checkr_idempotency_key uuid unique not null,
 stripe_session_id text unique check (stripe_session_id like 'cs_test_%'),
 checkout_url text,
 checkr_order_id text unique check (checkr_order_id like 'ord_test_%'),
 application_url text,
 report_id text,
 product_statuses jsonb,
 paid_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.screening_test_applications enable row level security;
revoke all on public.screening_test_applications from public, anon, authenticated;
grant select,insert,update on public.screening_test_applications to service_role;
-- No browser table access; Vercel checks administrator sessions or invitation tokens.

create table public.screening_test_payment_reviews (
 application_id uuid references public.screening_test_applications(id),
 stripe_session_id text primary key,
 reason text not null,
 created_at timestamptz not null default now()
);
alter table public.screening_test_payment_reviews enable row level security;
revoke all on public.screening_test_payment_reviews from public,anon,authenticated;
grant select,insert on public.screening_test_payment_reviews to service_role;
