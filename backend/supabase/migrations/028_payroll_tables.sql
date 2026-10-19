-- 028 PAYROLL TABLES
--
-- Salary as dated history, org-wide pay periods, salary-bound deficits, and
-- the close-once payment ledger. Convention (021): TEXT ids minted on the
-- device (periods/salary rows use deterministic uuids), no FKs, soft delete,
-- lamport_clock + dirty + updated_at for LWW.
--
-- Scoping: pay_periods / salary_history / salary_deficits / salary_payments
-- are ORG-scoped (all stores share one payroll cycle). salary_* rows keep the
-- writing store as stamped provenance; pay_periods has no store at all.
--
-- Write authority (enforced in middleware/src/routes/sync.ts):
--   • salary_history  — owner/admin only
--   • salary_deficits — supervisor ranks only (manager/admin/owner)
--   • salary_payments — server-only; client pushes are dropped
--   • pay_periods     — clients may create the open period; the pull's LWW
--                       keeps a closed row closed (server owns status)

-- ========== PAY PERIOD (org-wide cycle; status = open | closed) ==========
-- start_date/end_date are day keys (text), never instants. Cadence is
-- present but the UI stays hidden — everything defaults monthly, closing on
-- the last calendar day regardless of weekday/weekend.
create table if not exists pay_periods (
  id text primary key,
  organization_id text,
  store_id text,
  start_date text not null,
  end_date text not null,
  status text not null default 'open',
  cadence text not null default 'monthly',
  closed_at text,
  device_id text,
  lamport_clock bigint not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_pay_periods_org_start on pay_periods(organization_id, start_date);
-- At most one open period per org — the close endpoint flips status inside a
-- transaction, so a duplicate open can never race into existence.
create unique index if not exists idx_pay_periods_one_open
  on pay_periods(organization_id) where status = 'open' and is_deleted = false;

-- ========== SALARY HISTORY (append-only: current salary = latest row) ==========
-- Never overwritten. The first row per employee is deriveId("sal", emp, "init")
-- so every device's one-time backfill converges on the same cloud row.
create table if not exists salary_history (
  id text primary key,
  employee_id text not null,
  organization_id text,
  store_id text,
  amount double precision not null default 0,
  device_id text,
  lamport_clock bigint not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_salary_history_emp on salary_history(employee_id, created_at);

-- ========== SALARY DEFICIT (shortfalls EXPLICITLY taken from salary) ==========
-- Only ever written from the end-of-report decision "Pran sou salè" — a
-- negligible difference writes nothing. Permanent: no delete path exists.
-- period_id anchors the period containing `date`; all money math re-scopes by
-- date range, so a mis-anchored row can never skew a close.
create table if not exists salary_deficits (
  id text primary key,
  employee_id text not null,
  period_id text,
  organization_id text,
  store_id text,
  date text not null,
  amount double precision not null default 0,
  daily_report_id text,
  registered_by text,
  device_id text,
  lamport_clock bigint not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_salary_deficits_emp_date on salary_deficits(employee_id, date);
create index if not exists idx_salary_deficits_period on salary_deficits(period_id);

-- ========== SALARY PAYMENT (locked, one row per employee per period) ==========
-- Written ONLY by the close endpoint at the single moment a period closes:
-- salary snapshot − Σ period deficits = net. Deficits are already baked in.
-- The unique index makes a duplicate/concurrent close a no-op.
create table if not exists salary_payments (
  id text primary key,
  employee_id text not null,
  period_id text not null,
  organization_id text,
  store_id text,
  salary_amount double precision not null default 0,
  deficit_total double precision not null default 0,
  net_amount double precision not null default 0,
  closed_at text,
  device_id text,
  lamport_clock bigint not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_salary_payments_emp_period
  on salary_payments(employee_id, period_id) where is_deleted = false;
create index if not exists idx_salary_payments_period on salary_payments(period_id);
