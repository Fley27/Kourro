-- 019: credits may reference a sale the device later hard-deleted (SQLite runs
-- with foreign_keys off, so the dangling sale_id survives in real data). The
-- cloud must store the reference verbatim — a NULL would violate the device's
-- NOT NULL sale_id and break every pull.
ALTER TABLE public.credits DROP CONSTRAINT IF EXISTS credits_sale_id_fkey;
