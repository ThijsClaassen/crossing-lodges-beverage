-- Crossing Lodges Beverage Stock App — schema
-- Run this in the Supabase SQL editor of the SAME project used by crossing-lodges-ops
-- (https://arrendpmuwdhrfwvokhv.supabase.co), so both apps share one database and can
-- later be queried together from a company dashboard.
--
-- Naming follows the ops app's own recommendation: department-prefixed tables in one
-- shared project. This app uses the "bev_" prefix.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- bev_items — master beverage list. Item lists are FULLY SEPARATE per lodge
-- (unlike the shared `fleet` table in the ops app), so location_id lives here.
-- ---------------------------------------------------------------------------
create table if not exists bev_items (
  id                uuid primary key default gen_random_uuid(),
  location_id       text not null check (location_id in ('ZC','EC','SC')),
  name              text not null,
  category          text not null default 'Other',   -- Beer, Cider, Cordial, Red Wine, White Wine,
                                                        -- Soft Drinks, Spirits, Water, Consumables, Other
  count_unit        text not null default 'ea',       -- 'ea', 'ltr', 'tot', etc.
  pricing_tier      text not null default 'Included'  -- 'Included' (all-inclusive) or 'Premium'
                      check (pricing_tier in ('Included', 'Premium')),
  storeroom         text,                              -- e.g. 'A', 'B'
  shelf             text,                              -- e.g. 'Top', 'Middle', 'Bottom'
  shelf_position    text,                              -- e.g. 'Front', 'Back'
  min_units         numeric not null default 0,        -- reorder trigger point
  max_units         numeric not null default 0,        -- reorder target level
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

create index if not exists idx_bev_items_location on bev_items(location_id);

-- ---------------------------------------------------------------------------
-- bev_stock_periods — one row per item per location per period (e.g. '2026-07').
-- Holds opening stock (carried forward from the prior period's closing count)
-- and the physical closing count once the stock take is done.
-- ---------------------------------------------------------------------------
create table if not exists bev_stock_periods (
  id                    uuid primary key default gen_random_uuid(),
  item_id               uuid not null references bev_items(id) on delete cascade,
  location_id           text not null check (location_id in ('ZC','EC','SC')),
  period                text not null,                 -- 'YYYY-MM'
  opening_units         numeric not null default 0,
  opening_cost_per_unit numeric not null default 0,
  closing_count_units   numeric,                        -- null until the physical count is entered
  counted_by            text,
  count_date            date,
  closed                boolean not null default false, -- locks the period once counted & reviewed
  created_at            timestamptz not null default now(),
  unique (item_id, period)
);

create index if not exists idx_bev_stock_periods_lookup on bev_stock_periods(location_id, period);

-- ---------------------------------------------------------------------------
-- bev_purchases — one row per purchase (replaces the fixed "5 purchase slots"
-- in the old sheet; you can log as many purchases per item/period as needed).
-- ---------------------------------------------------------------------------
create table if not exists bev_purchases (
  id                    uuid primary key default gen_random_uuid(),
  item_id               uuid not null references bev_items(id) on delete cascade,
  location_id           text not null check (location_id in ('ZC','EC','SC')),
  period                text not null,                 -- 'YYYY-MM', derived from date at entry time
  date                  date not null,
  units                 numeric not null default 0,
  total_cost_excl_vat   numeric not null default 0,
  supplier              text,
  created_at            timestamptz not null default now()
);

create index if not exists idx_bev_purchases_lookup on bev_purchases(location_id, period, item_id);

-- ---------------------------------------------------------------------------
-- bev_issues — v1: simple daily total per item (no cost-centre breakdown yet).
-- Replaces the fixed 10-cost-centre column grid in the old sheet. Adding
-- cost-centre detail later just means adding a cost_centre_id column here —
-- no redesign of the table needed.
-- ---------------------------------------------------------------------------
create table if not exists bev_issues (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references bev_items(id) on delete cascade,
  location_id   text not null check (location_id in ('ZC','EC','SC')),
  period        text not null,                 -- 'YYYY-MM', derived from date at entry time
  date          date not null,
  qty           numeric not null default 0,
  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_bev_issues_lookup on bev_issues(location_id, period, item_id);

-- ---------------------------------------------------------------------------
-- bev_access — Admin/Staff login, matching the ops app's shared-password
-- pattern (own table, not shared with the ops app's app_access).
-- ---------------------------------------------------------------------------
create table if not exists bev_access (
  id          uuid primary key default gen_random_uuid(),
  role        text not null unique check (role in ('admin', 'staff')),
  password    text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security — matching the ops app's current approach (open allow_all
-- policies via the anon key). Same caveat applies: no per-user audit trail.
-- ---------------------------------------------------------------------------
alter table bev_items          enable row level security;
alter table bev_stock_periods  enable row level security;
alter table bev_purchases      enable row level security;
alter table bev_issues         enable row level security;
alter table bev_access         enable row level security;

create policy allow_all_bev_items on bev_items
  for all using (true) with check (true);
create policy allow_all_bev_stock_periods on bev_stock_periods
  for all using (true) with check (true);
create policy allow_all_bev_purchases on bev_purchases
  for all using (true) with check (true);
create policy allow_all_bev_issues on bev_issues
  for all using (true) with check (true);
-- bev_access only ever needs to be READ by the app (to check a password);
-- it's never written to from the client. Change passwords via the Table
-- Editor, not through the app.
create policy allow_read_bev_access on bev_access
  for select using (true);

-- ---------------------------------------------------------------------------
-- Baseline table grants. RLS policies above control row-level access, but
-- Postgres separately requires grants for the anon/authenticated roles to
-- touch these tables at all — without this block you'll get "permission
-- denied for table ..." (42501) even with the allow_all policies in place.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.bev_items          to anon, authenticated;
grant select, insert, update, delete on public.bev_stock_periods  to anon, authenticated;
grant select, insert, update, delete on public.bev_purchases      to anon, authenticated;
grant select, insert, update, delete on public.bev_issues         to anon, authenticated;
grant select on public.bev_access to anon, authenticated;

-- Default Admin/Staff passwords — CHANGE THESE immediately via the Table
-- Editor (bev_access table) after setup.
insert into bev_access (role, password) values
  ('admin', 'ChangeMe-Admin1'),
  ('staff', 'ChangeMe-Staff1')
on conflict (role) do nothing;
