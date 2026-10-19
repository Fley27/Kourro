-- Tier upgrades bill a prorated stub invoice (kind = tier_upgrade). 001 already
-- includes the value on fresh installs, so this only updates databases that ran
-- an older 001. Idempotent: safe to re-run (constraint is dropped and recreated
-- with the same definition).
alter table adm_invoices drop constraint if exists adm_invoices_kind_check;
alter table adm_invoices
  add constraint adm_invoices_kind_check
  check (kind in ('initial','renewal','seat_proration','manual','tier_upgrade'));
