-- 002 Customer credit system — ID card, unlimited limits, per-transaction Debt IDs, risk flag
-- Extends 001 schema for haitian store credit rules

-- Add ID card to customers (national ID to distinguish same names)
alter table customers add column if not exists id_card_number text;
create unique index if not exists idx_customers_id_card_store on customers(store_id, id_card_number) where id_card_number is not null;
create index if not exists idx_customers_id_card on customers(id_card_number);

-- Make credit_limit nullable: NULL = unlimited (was 0 = no limit)
-- Keep total_debt as running total of unpaid balances
alter table customers alter column credit_limit drop not null;
alter table customers alter column credit_limit drop default;
update customers set credit_limit = null where credit_limit = 0;
-- Now: NULL = unlimited, number = hard limit

-- Add credit source tracking: manual vs auto, and when it was set
alter table customers add column if not exists credit_limit_source text check (credit_limit_source in ('manual','auto'));
alter table customers add column if not exists credit_limit_set_at timestamptz;
alter table customers add column if not exists credit_limit_set_by uuid references profiles(id);

-- Add flag for "will be late" notice to avoid penalty
-- Customers can proactively flag a debt will be late via notes on credit
alter table credits add column if not exists will_be_late boolean not null default false;
alter table credits add column if not exists will_be_late_reason text;
alter table credits add column if not exists will_be_late_at timestamptz;

-- Rename credits conceptually to debts (keep table name credits for compatibility, but add Debt ID alias)
-- Each credit row IS a Debt ID (unique per transaction) — already is per sale.
-- Add receipt tracking for payments
alter table credit_payments add column if not exists receipt_number text unique;
alter table credit_payments add column if not exists debt_id uuid; -- alias for credit_id
update credit_payments set debt_id = credit_id where debt_id is null;

-- Ensure Debt ID is exposed as debt_id in API (keep credit_id for compat)
create or replace view v_customer_debts as
select
  c.id as debt_id,
  c.id as credit_id,
  c.customer_id,
  c.store_id,
  c.sale_id,
  c.amount,
  c.amount_paid,
  c.balance,
  c.status,
  c.due_date,
  c.will_be_late,
  c.created_at,
  s.sale_number,
  s.total as sale_total
from credits c
join sales s on s.id = c.sale_id
where c.is_deleted = false;

-- Risk flag view: any customer with outstanding unpaid debt is high risk
create or replace view v_customer_risk as
select
  cu.id,
  cu.store_id,
  cu.name,
  cu.id_card_number,
  cu.phone,
  cu.credit_limit,
  cu.credit_limit_source,
  cu.total_debt,
  case when cu.total_debt > 0 and exists (
    select 1 from credits cr where cr.customer_id = cu.id and cr.is_deleted = false and cr.balance > 0
  ) then true else false end as is_high_risk,
  (select count(*) from credits cr where cr.customer_id = cu.id and cr.is_deleted = false and cr.balance > 0) as open_debt_count,
  (select coalesce(sum(balance),0) from credits cr where cr.customer_id = cu.id and cr.is_deleted = false) as computed_total_owed
from customers cu
where cu.is_deleted = false;

-- Revenue breakdown view: splits daily revenue into cash/credit/debt-paid
create or replace view v_revenue_daily as
select
  store_id,
  date(created_at) as day,
  sum(case when payment_method = 'cash' and status = 'completed' then total else 0 end) as cash_sales,
  sum(case when payment_method = 'credit' then total else 0 end) as credit_sales,
  0 as debt_paid -- debt_paid comes from credit_payments, union below
from sales where is_deleted = false group by store_id, date(created_at)
union all
select store_id, date(created_at) as day, 0, 0, sum(amount) as debt_paid
from credit_payments where is_deleted = false group by store_id, date(created_at);

-- Helper function for penalty: call after a debt is fully paid
create or replace function apply_late_penalty(p_credit_id uuid) returns void as $$
declare
  v_customer_id uuid;
  v_due_date date;
  v_will_be_late boolean;
  v_status text;
  v_balance numeric;
  v_limit numeric;
  v_limit_source text;
  v_paid_amount numeric;
begin
  select customer_id, due_date, will_be_late, status, balance, credit_limit, credit_limit_source, amount
  into v_customer_id, v_due_date, v_will_be_late, v_status, v_balance, v_limit, v_limit_source, v_paid_amount
  from credits join customers on customers.id = credits.customer_id
  where credits.id = p_credit_id;

  -- Only if fully paid, was overdue, and had no prior notice
  if v_balance = 0 and v_status = 'paid' and v_due_date is not null and v_due_date < current_date and v_will_be_late = false then
    -- If no prior limit existed, basis is the paid-off amount; otherwise previous limit
    -- Once a limit exists (manual or auto), it governs until manager edits
    if v_limit is null then
      -- No prior limit: set to 75% of paid amount
      update customers set credit_limit = v_paid_amount * 0.75, credit_limit_source = 'auto', credit_limit_set_at = now()
      where id = v_customer_id and credit_limit is null;
    else
      -- Has prior limit: reduce by 25%
      update customers set credit_limit = v_limit * 0.75, credit_limit_source = 'auto', credit_limit_set_at = now()
      where id = v_customer_id;
    end if;
  end if;
end; $$ language plpgsql;

-- Trigger to auto-apply penalty after credit is fully paid
create or replace function trg_credit_paid_penalty() returns trigger as $$
begin
  if new.balance = 0 and new.status = 'paid' and old.balance <> 0 then
    perform apply_late_penalty(new.id);
  end if;
  return new;
end; $$ language plpgsql;
drop trigger if exists trg_penalty on credits;
create trigger trg_penalty after update on credits for each row execute function trg_credit_paid_penalty();

-- Update profiles role check to include owner/manager/cashier/admin for new hierarchy
-- Keep existing but ensure owner/manager/admin/cashier are allowed for customer creation (handled in middleware RLS, not DB)
