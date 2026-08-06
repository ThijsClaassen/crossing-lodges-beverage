-- v4 migration — run this once in the Supabase SQL editor.
-- Adds suppliers (per lodge), links items to a supplier, and adds a reason
-- to issues so write-offs (breakage, expired, staff usage) can be tracked
-- separately from normal guest consumption.

-- 1. Suppliers, one list per lodge ------------------------------------------
create table if not exists bev_suppliers (
  id            uuid primary key default gen_random_uuid(),
  location_id   text not null check (location_id in ('ZC', 'EC', 'SC')),
  name          text not null,
  contact_name  text,
  phone         text,
  email         text,
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists idx_bev_suppliers_location on bev_suppliers(location_id);

alter table bev_suppliers enable row level security;

drop policy if exists allow_all_bev_suppliers on bev_suppliers;
create policy allow_all_bev_suppliers on bev_suppliers
  for all using (true) with check (true);

grant select, insert, update, delete on public.bev_suppliers to anon, authenticated;

-- 2. Link items to a supplier ------------------------------------------------
alter table bev_items
  add column if not exists supplier_id uuid references bev_suppliers(id) on delete set null;

create index if not exists idx_bev_items_supplier on bev_items(supplier_id);

-- 3. Write-off reason on issues ----------------------------------------------
-- Plain text, not a DB check constraint — the dropdown options live in the
-- app code, so adding a new reason later is a small code change, not
-- another migration. Existing rows default to 'Service' (normal
-- consumption), same meaning "issues" always had before this migration.
alter table bev_issues
  add column if not exists reason text not null default 'Service';
