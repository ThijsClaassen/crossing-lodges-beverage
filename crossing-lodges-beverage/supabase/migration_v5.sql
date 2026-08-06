-- v5 migration — run this once in the Supabase SQL editor.
-- Adds order-pack rounding: you count stock in whatever unit makes sense
-- (ml for spirits measured by the tot, "ea" for cans/bottles, etc.) via
-- count_unit, which already existed — but you don't always ORDER in that
-- same unit. A 750ml bottle is one order unit even though you count it in
-- ml; a Coke is one order unit even though it arrives in six-packs.
--
-- order_pack_size = how many count_units make up one orderable pack
--   e.g. count_unit = 'ml', order_pack_size = 750  → order in whole bottles
--   e.g. count_unit = 'ea', order_pack_size = 6     → order in whole six-packs
--   default 1 = order in the same unit you count in (today's behaviour,
--   unchanged for any item you don't touch).
-- order_pack_label = free text shown on the Orders tab and in the copied
--   order list, e.g. "750ml bottle", "6-pack", "case of 24".

alter table bev_items
  add column if not exists order_pack_size numeric not null default 1;

alter table bev_items
  add column if not exists order_pack_label text;
