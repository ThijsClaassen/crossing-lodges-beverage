-- Beverage Stock 3c: rewrite RLS to company-scoped. This repo has a
-- committed schema.sql, so the existing policy names are known exactly
-- (unlike Ops/Maintenance) — drop each by name and replace with
-- has_company_access(company_id). bev_access is left untouched (read-only
-- from the client, unused since 3b shipped real auth).

drop policy if exists allow_all_bev_items on bev_items;
create policy "allow_company_bev_items" on bev_items
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

drop policy if exists allow_all_bev_stock_periods on bev_stock_periods;
create policy "allow_company_bev_stock_periods" on bev_stock_periods
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

drop policy if exists allow_all_bev_purchases on bev_purchases;
create policy "allow_company_bev_purchases" on bev_purchases
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

drop policy if exists allow_all_bev_issues on bev_issues;
create policy "allow_company_bev_issues" on bev_issues
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

drop policy if exists allow_all_bev_suppliers on bev_suppliers;
create policy "allow_company_bev_suppliers" on bev_suppliers
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

alter table bev_items          enable row level security;
alter table bev_stock_periods  enable row level security;
alter table bev_purchases      enable row level security;
alter table bev_issues         enable row level security;
alter table bev_suppliers      enable row level security;

-- Verification: exactly one allow_company_* policy per table
select tablename, policyname, cmd
from pg_policies
where tablename in ('bev_items','bev_stock_periods','bev_purchases','bev_issues','bev_suppliers')
order by tablename;
