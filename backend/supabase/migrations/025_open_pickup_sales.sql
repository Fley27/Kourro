-- 025: open-pickup sales RPC for the sync open-items sweep.
--
-- "Open pickup" = a sale line with undelivered quantity
-- (quantity_delivered < quantity). That is a column-to-column comparison,
-- which PostgREST filters cannot express (`quantity_delivered=lt.quantity`
-- makes Postgres cast the *name* "quantity" to double precision and 400s).
-- So the middleware resolves the open sale ids through this function and
-- pulls those sales' lines by id instead.
--
-- Idempotent-ish by convention (see 023 / backend/src/migrate.ts).

create or replace function public.open_pickup_sale_ids(p_store_ids uuid[])
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select distinct si.sale_id
  from public.sale_items si
  where si.store_id = any (p_store_ids)
    and coalesce(si.is_deleted, false) = false
    and coalesce(si.quantity_delivered, 0) < coalesce(si.quantity, 0);
$$;
