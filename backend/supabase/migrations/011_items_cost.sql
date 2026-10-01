-- 011 PERSISTED item purchase cost.
--
-- items.cost = what ONE unit of that container costs us, written by the
-- device that calculated it (own received batches Σtotal_paid/Σquantity, else
-- the supplier quote, else the ratio chain from a sibling item, else the cost
-- the owner typed in). The app used to derive this at display time only and
-- never stored it, so items could exist with no cost at all. Same conventions
-- as 007: text ids, soft delete, global (no store scope).
alter table items add column if not exists cost numeric(16,6) not null default 0;

comment on column items.cost is
  'Unit purchase cost: batch-derived, supplier quote, ratio chain, or owner entry. 0 = not priced yet.';
