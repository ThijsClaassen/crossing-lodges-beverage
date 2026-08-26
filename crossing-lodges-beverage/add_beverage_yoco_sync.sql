-- Run once in the Supabase SQL editor.
--
-- Yoco Phase 2 for Beverage Stock (2026-08-26) — auto-issue stock when the
-- POS sells a drink. Phase 1 (already live) syncs Yoco sales into the
-- Finance Dashboard's income categories; Curio got the stock side of it
-- first, and this is the same thing for Beverage.
--
-- Beverage is the easy half of Phase 2: a drink sold IS a stock item, so
-- one Yoco line -> one bev_issues row, exactly like Curio. (Food is the
-- awkward half — a "Beef Burger" line is a dish, not stock, so that app
-- explodes recipes into ingredients and needs item_id in its dedup key.
-- See add_food_yoco_sync.sql. Nothing like that is needed here.)
--
-- How Food and Beverage stay out of each other's way: Yoco's own
-- classification only reaches "premium food and beverages" — it can't tell
-- a beer from a burger. So each app filters to that income category and
-- then tries to match the line against ITS OWN item list. A beer matches
-- bev_items and not food's recipes; a burger matches a food recipe and not
-- bev_items. Anything neither app recognises shows up in both apps'
-- unmatched panels, which is the correct outcome — a person decides.
--
-- Issue reason is 'Service' — the existing "normal use" reason here
-- (confirmed with Thijs 2026-08-26), already excluded from write-off
-- reporting, so Usage and variance maths need no changes.
--
-- Safe to re-run.

-- 1. Link bev_issues back to the Yoco line that caused it -----------------

alter table bev_issues
  add column if not exists yoco_line_item_id uuid references pos_sales_line_items(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bev_issues_company_yoco_line_item_key'
  ) then
    alter table bev_issues
      add constraint bev_issues_company_yoco_line_item_key
      unique (company_id, yoco_line_item_id);
  end if;
end $$;

create index if not exists idx_bev_issues_yoco_line_item on bev_issues (yoco_line_item_id);

-- 2. Taught matches: Yoco item name -> bev_items row ---------------------
--
-- Same shape as curio_yoco_item_aliases: teach a name once and it's used
-- verbatim forever, so the fuzzy matcher can't drift onto a different item
-- later. Yoco item names don't change.

create table if not exists bev_yoco_item_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  yoco_item_name text not null,
  item_id uuid not null references bev_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (company_id, yoco_item_name)
);

create index if not exists idx_bev_yoco_aliases_company on bev_yoco_item_aliases (company_id);

alter table bev_yoco_item_aliases enable row level security;

drop policy if exists "read_company_bev_yoco_aliases" on bev_yoco_item_aliases;
create policy "read_company_bev_yoco_aliases" on bev_yoco_item_aliases
  for select using (has_company_access(company_id));

drop policy if exists "write_company_bev_yoco_aliases" on bev_yoco_item_aliases;
create policy "write_company_bev_yoco_aliases" on bev_yoco_item_aliases
  for all using (has_company_access(company_id))
  with check (has_company_access(company_id));

-- =========================================================================
-- VERIFICATION
-- =========================================================================

select column_name from information_schema.columns
where table_name = 'bev_issues' and column_name = 'yoco_line_item_id';

select conname from pg_constraint
where conname = 'bev_issues_company_yoco_line_item_key';

select count(*) as alias_rows from bev_yoco_item_aliases;

-- REMINDER: bev_yoco_item_aliases is a NEW table — switch it on under
-- Data API -> Exposed tables, or every read/write from the app 404s.
