-- 018: employee_stores is pair-keyed and had no updated_at, so pull
-- (`updated_at > since`) could never return store links to devices.
ALTER TABLE public.employee_stores
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
