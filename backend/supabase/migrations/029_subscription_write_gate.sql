-- 029 SUBSCRIPTION WRITE GATE
--
-- Reads always work; NEW business writes stop when the org's subscription is
-- not writable: no row at all, paused/cancelled, or an expired trial/renewal.
-- Close-out updates (close a shift, cancel an order/line, deny a change…)
-- always pass — otherwise open records and pay windows stay stranded forever.
--
-- Layered enforcement (same rule everywhere):
--   1. device  — mobile guardWrite() blocks the UI action immediately
--   2. middleware — push pre-check answers error:subscription_expired
--      (friendly, keeps the client's outbox rows queued without burning retries)
--   3. HERE — a trigger, so even service-role / direct-PostgREST writes cannot
--      bypass the gate (RLS does not apply to the service role; triggers do).
--
-- Scope: operational + catalog + payroll tables (org or store derivable).
-- Excluded on purpose:
--   • notifications / daily_reports — infra bookkeeping (always writable; a
--     shift close must be able to write its report row)
--   • profiles / store_members / employee_stores / stores / organizations /
--     subscriptions / plans — identity + onboarding: a brand-new signup has
--     no subscription yet and must still create its profile/org/store.
--
-- Writability rule (mirrors packages/shared-types isSubscriptionWritable):
--   trial  → trial_ends_at is null or in the future
--   active → renews_at is null or in the future
--   paused / cancelled / missing row → NOT writable

-- ========== WRITABILITY (latest subscription row for the org) ==========
create or replace function subscription_writable(p_org text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when s.status = 'trial'  then (s.trial_ends_at is null or s.trial_ends_at > now())
      when s.status = 'active' then (s.renews_at is null or s.renews_at > now())
      else false
    end
    from subscriptions s
    where p_org is not null and s.organization_id::text = p_org
    order by s.created_at desc
    limit 1
  ), false);
$$;

-- ========== BACKFILL: orgs without any subscription row get a trial ==========
-- "Missing row = read-only" is enforced from now on; legacy businesses that
-- never had a portal subscription row would otherwise lock out immediately.
-- 14 days from now, plan 'basic' (seeded in 003). Admin billing mirrors the
-- real window into this table on every renewal (see admin-portal services).
insert into subscriptions (organization_id, plan_code, status, trial_ends_at)
select o.id, 'basic', 'trial', now() + interval '14 days'
from organizations o
where not exists (select 1 from subscriptions s where s.organization_id = o.id);

-- ========== WRITE GATE (row-level trigger) ==========
-- Type-agnostic (uuid and text org/store columns both exist in this schema):
-- to_jsonb() avoids referencing columns a given table may not have, and the
-- org falls back to the row's store's organization for store-scoped tables.
create or replace function enforce_subscription_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec jsonb;
  org text;
  status text;
begin
  if tg_op = 'DELETE' then
    rec := to_jsonb(old);
  else
    rec := to_jsonb(new);
  end if;

  org := nullif(rec->>'organization_id', '');
  if org is null then
    select s.organization_id::text into org
    from stores s
    where s.id::text = nullif(rec->>'store_id', '')
    limit 1;
  end if;

  if subscription_writable(org) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- Close-out allowance: only an UPDATE moving a row INTO a terminal status
  -- passes while read-only. Must match CLOSE_OUT_TABLES / CLOSE_OUT_STATUSES
  -- in packages/shared-types.
  if tg_op = 'UPDATE'
     and tg_table_name in (
       'shifts', 'open_orders', 'open_order_lines', 'order_change_requests',
       'open_order_events', 'suspended_sales', 'standby_hands', 'orders',
       'proformats'
     ) then
    status := rec->>'status';
    if status in ('closed', 'cancelled', 'canceled', 'denied', 'completed', 'rejected', 'done') then
      return new;
    end if;
  end if;

  raise exception 'subscription_expired'
    using errcode = 'P0001',
          hint = 'Abònman an ekspire — ekriti bloke. Konekte ak pwopriyetè a pou renouvle.';
end;
$$;

-- ========== ATTACH (only where an org or store column exists) ==========
do $$
declare
  t text;
  gated text[] := array[
    -- core
    'products','product_stock','customers','sales','sale_items','credits',
    'credit_payments','price_history','categories','cash_sessions',
    'stock_movements','stock_batches','suppliers','supplier_bank_accounts',
    -- catalog chain
    'items','variants','variant_prices','bundles','bundle_prices',
    'product_units','product_supplier_costs','product_suppliers',
    'product_categories','category_links','batches',
    -- purchasing
    'orders',
    -- assisted orders
    'open_orders','open_order_lines','order_change_requests','open_order_events',
    -- promos
    'proformats','discounts','coupons','coupon_redemptions','promo_audit',
    -- operations
    'sale_pickups','shifts','suspended_sales','suspended_sale_items','standby_hands',
    -- payroll
    'pay_periods','salary_history','salary_deficits','salary_payments'
  ];
begin
  foreach t in array gated loop
    if exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = t
        and c.column_name in ('organization_id', 'store_id')
    ) then
      execute format('drop trigger if exists trg_subscription_write_gate on public.%I', t);
      execute format(
        'create trigger trg_subscription_write_gate before insert or update or delete on public.%I '
        'for each row execute function enforce_subscription_write()', t);
    end if;
  end loop;
end $$;
