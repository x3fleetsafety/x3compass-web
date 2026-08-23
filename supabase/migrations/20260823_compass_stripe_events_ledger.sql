-- The deployed Compass schema uses the compass_* naming family.  Keep the
-- Stripe idempotency ledger available for fresh preview/staging projects;
-- existing installations are unchanged by IF NOT EXISTS.
create table if not exists public.compass_stripe_events (
  id text primary key,
  type text not null,
  carrier_id uuid,
  payload jsonb not null,
  processed_at timestamptz,
  received_at timestamptz default now()
);

create index if not exists idx_compass_stripe_events_processed
  on public.compass_stripe_events(processed_at);

alter table public.compass_stripe_events enable row level security;
