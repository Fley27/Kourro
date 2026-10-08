-- 016: compatibility fixes for device -> cloud sync pushes.
--
-- Devices encode lamport_clock as a hybrid-logical-clock timestamp in epoch
-- milliseconds (e.g. 1790806111165), which overflows int4 on insert.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'lamport_clock'
      AND data_type = 'integer'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN lamport_clock TYPE bigint', r.table_name);
  END LOOP;
END $$;

-- Devices may push legacy sales rows whose discount was never set: accept NULL
-- (default 0 still covers inserts that omit the column).
ALTER TABLE public.sales ALTER COLUMN discount DROP NOT NULL;
ALTER TABLE public.sales ALTER COLUMN discount SET DEFAULT 0;

-- An empty id_card_number means "no id card": repeated blanks must not collide
-- on the per-store unique index.
DROP INDEX IF EXISTS public.idx_customers_id_card_store;
CREATE UNIQUE INDEX idx_customers_id_card_store
  ON public.customers (store_id, id_card_number)
  WHERE id_card_number IS NOT NULL AND id_card_number <> '';
