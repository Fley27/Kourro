-- Delivery identity + transport on v2 batches (Inventory main screen).
-- A delivery (one Nouvo livrezon save, one legacy stock_batch) spans many
-- batch lines: delivery_ref prints on the card (LIV-004823), transport_share
-- is the line's slice of transport so the card can show Transpò vs Total.
alter table batches add column if not exists delivery_ref text;
alter table batches add column if not exists transport_share numeric(16,2) not null default 0;
create index if not exists idx_batches_delivery_ref on batches(delivery_ref);
