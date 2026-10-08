-- 020: the device stores pre-rounding cost precision (numeric floats). At
-- (12,2) every pull-back of sale_items.cost_price / product_supplier_costs.cost
-- would shave the restored precision off again (e.g. 253778.8176 -> 253778.82).
DROP VIEW public.v_profit_daily;
ALTER TABLE public.sale_items ALTER COLUMN cost_price TYPE numeric(16,6);
ALTER TABLE public.product_supplier_costs ALTER COLUMN cost TYPE numeric(16,6);
CREATE VIEW public.v_profit_daily AS
 SELECT s.store_id,
    date(s.created_at) AS day,
    count(*) AS sales_count,
    sum(s.total) AS revenue,
    sum(si.cost_price * si.quantity) AS total_cost,
    sum(s.total - si.cost_price * si.quantity) AS gross_profit
   FROM sales s
     JOIN sale_items si ON si.sale_id = s.id
  WHERE s.status <> 'cancelled'::text AND s.is_deleted = false
  GROUP BY s.store_id, (date(s.created_at));
