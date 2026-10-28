-- TEST STAGING ONLY. Apply to a separate test database; never copy real applicants.
create table public.screening_applications (
 id uuid primary key,
 token_hash text not null,
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
alter table public.screening_applications enable row level security;
revoke all on public.screening_applications from public, anon, authenticated;
grant select,insert,update on public.screening_applications to service_role;
-- No browser table access; Vercel checks administrator sessions or invitation tokens.
