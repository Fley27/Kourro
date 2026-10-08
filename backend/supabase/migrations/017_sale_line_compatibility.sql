-- 017: let device sale/payment rows round-trip.
--
-- The POS writes moncash/natcash as payment_method (mobile-app/src/sales/checkout.ts)
-- while the schema only allowed cash/credit/mobile_money/mixed.
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IN ('cash', 'credit', 'mobile_money', 'mixed', 'moncash', 'natcash'));

ALTER TABLE public.credit_payments DROP CONSTRAINT IF EXISTS credit_payments_payment_method_check;
ALTER TABLE public.credit_payments ADD CONSTRAINT credit_payments_payment_method_check
  CHECK (payment_method IN ('cash', 'credit', 'mobile_money', 'mixed', 'moncash', 'natcash'));

-- Devices hard-delete products while historical sale_items keep product_id
-- (SQLite runs with foreign_keys off), so 18 orphan references exist. Mirror
-- that offline reality in the cloud instead of rejecting the sale lines.
ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_product_id_fkey;
