-- v2 migration — run this once in the Supabase SQL editor for the
-- arrendpmuwdhrfwvokhv project. Safe to run on the already-deployed database
-- (uses IF NOT EXISTS / ON CONFLICT throughout).
--
-- Adds:
--   1. bev_items.pricing_tier — 'Included' (all-inclusive) or 'Premium'
--   2. bev_access — Admin/Staff login, matching the ops app's shared-password
--      pattern (its own table, not shared with the ops app's app_access)

-- 1. Pricing tier on each item -----------------------------------------------
alter table bev_items
  add column if not exists pricing_tier text not null default 'Included'
  check (pricing_tier in ('Included', 'Premium'));

-- 2. Admin/Staff access ------------------------------------------------------
create table if not exists bev_access (
  id          uuid primary key default gen_random_uuid(),
  role        text not null unique check (role in ('admin', 'staff')),
  password    text not null,
  created_at  timestamptz not null default now()
);

alter table bev_access enable row level security;

-- The app only ever needs to READ this table (to check a password); it never
-- writes to it, so only a select policy/grant is needed. Change passwords
-- directly in the Supabase Table Editor.
drop policy if exists allow_read_bev_access on bev_access;
create policy allow_read_bev_access on bev_access
  for select using (true);

grant usage on schema public to anon, authenticated;
grant select on public.bev_access to anon, authenticated;

-- Default passwords — CHANGE THESE in the Table Editor immediately after
-- running this migration (Table Editor → bev_access → edit the password
-- cell for each row).
insert into bev_access (role, password) values
  ('admin', 'ChangeMe-Admin1'),
  ('staff', 'ChangeMe-Staff1')
on conflict (role) do nothing;
