-- v3 migration — run this once in the Supabase SQL editor.
-- Adds a barcode column to bev_items for the Count tab's "Scan mode":
-- scan a bottle's barcode, and if it's been linked to an item before, the
-- app jumps straight to that item's count field.

alter table bev_items
  add column if not exists barcode text;

create index if not exists idx_bev_items_barcode on bev_items(location_id, barcode);

-- No uniqueness constraint on purpose — if two different-looking items
-- somehow share a barcode (e.g. a mislabeled scan), the app just shows the
-- first match rather than erroring out.
