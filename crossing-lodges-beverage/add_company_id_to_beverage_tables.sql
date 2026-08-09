-- Beverage Stock 3a: add company_id to all 5 bev_-owned tables, drop the
-- hardcoded ZC/EC/SC location checks (same pattern as every prior app in
-- this migration). bev_access is deliberately left untouched — same
-- treatment as food_access/hr_access, becomes unused once 3b ships real auth.

-- ---------------------------------------------------------------------------
-- bev_items
-- ---------------------------------------------------------------------------
alter table bev_items add column if not exists company_id uuid references companies(id);
alter table bev_items alter column company_id set default default_crossing_lodges_company_id();
update bev_items set company_id = default_crossing_lodges_company_id() where company_id is null;
alter table bev_items alter column company_id set not null;
create index if not exists idx_bev_items_company on bev_items(company_id);
alter table bev_items drop constraint if exists bev_items_location_id_check;

-- ---------------------------------------------------------------------------
-- bev_stock_periods
-- ---------------------------------------------------------------------------
alter table bev_stock_periods add column if not exists company_id uuid references companies(id);
alter table bev_stock_periods alter column company_id set default default_crossing_lodges_company_id();
update bev_stock_periods set company_id = default_crossing_lodges_company_id() where company_id is null;
alter table bev_stock_periods alter column company_id set not null;
create index if not exists idx_bev_stock_periods_company on bev_stock_periods(company_id);
alter table bev_stock_periods drop constraint if exists bev_stock_periods_location_id_check;

-- ---------------------------------------------------------------------------
-- bev_purchases
-- ---------------------------------------------------------------------------
alter table bev_purchases add column if not exists company_id uuid references companies(id);
alter table bev_purchases alter column company_id set default default_crossing_lodges_company_id();
update bev_purchases set company_id = default_crossing_lodges_company_id() where company_id is null;
alter table bev_purchases alter column company_id set not null;
create index if not exists idx_bev_purchases_company on bev_purchases(company_id);
alter table bev_purchases drop constraint if exists bev_purchases_location_id_check;

-- ---------------------------------------------------------------------------
-- bev_issues
-- ---------------------------------------------------------------------------
alter table bev_issues add column if not exists company_id uuid references companies(id);
alter table bev_issues alter column company_id set default default_crossing_lodges_company_id();
update bev_issues set company_id = default_crossing_lodges_company_id() where company_id is null;
alter table bev_issues alter column company_id set not null;
create index if not exists idx_bev_issues_company on bev_issues(company_id);
alter table bev_issues drop constraint if exists bev_issues_location_id_check;

-- ---------------------------------------------------------------------------
-- bev_suppliers
-- ---------------------------------------------------------------------------
alter table bev_suppliers add column if not exists company_id uuid references companies(id);
alter table bev_suppliers alter column company_id set default default_crossing_lodges_company_id();
update bev_suppliers set company_id = default_crossing_lodges_company_id() where company_id is null;
alter table bev_suppliers alter column company_id set not null;
create index if not exists idx_bev_suppliers_company on bev_suppliers(company_id);
alter table bev_suppliers drop constraint if exists bev_suppliers_location_id_check;

-- ---------------------------------------------------------------------------
-- Verification: total row count should equal with_company on every table
-- ---------------------------------------------------------------------------
select 'bev_items' as table_name, count(*) as total, count(company_id) as with_company from bev_items
union all
select 'bev_stock_periods', count(*), count(company_id) from bev_stock_periods
union all
select 'bev_purchases', count(*), count(company_id) from bev_purchases
union all
select 'bev_issues', count(*), count(company_id) from bev_issues
union all
select 'bev_suppliers', count(*), count(company_id) from bev_suppliers;
