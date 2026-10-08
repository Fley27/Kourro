-- 022: collapse duplicated categories.
--
-- Editing a category used to re-key its id on the device, so the cloud stored
-- BOTH the old id and the fresh one under the same name; the next pull handed
-- that twin to every register ("kategori sove de fwa").
--
-- Keep one row per name per store — the one products point at, else the one
-- that carries a sort_order, else the oldest — move every reference onto it
-- and tombstone the rest. The tombstone bumps updated_at (trg_categories_
-- updated), so every device converges on its next pull. Idempotent: it only
-- touches names that are still duplicated.

DO $$
DECLARE
  grp    RECORD;
  keeper public.categories%ROWTYPE;
  lid    uuid;
BEGIN
  FOR grp IN
    SELECT store_id,
           btrim(lower(name)) AS n,
           array_agg(id ORDER BY (sort_order IS NULL), created_at, id) AS ids
    FROM public.categories
    WHERE is_deleted = false
    GROUP BY store_id, btrim(lower(name))
    HAVING count(*) > 1
  LOOP
    -- 1) the copy products actually reference ...
    SELECT * INTO keeper
    FROM public.categories c
    WHERE c.id = ANY (grp.ids)
      AND EXISTS (SELECT 1 FROM public.products p WHERE p.category_id = c.id)
    ORDER BY (c.sort_order IS NULL), c.created_at, c.id
    LIMIT 1;

    -- 2) ... else the one that owns a sort order, else the oldest.
    IF keeper.id IS NULL THEN
      SELECT * INTO keeper
      FROM public.categories c
      WHERE c.id = ANY (grp.ids)
      ORDER BY (c.sort_order IS NULL), c.created_at, c.id
      LIMIT 1;
    END IF;

    FOR i IN 1 .. array_length(grp.ids, 1) LOOP
      lid := grp.ids[i];
      CONTINUE WHEN lid = keeper.id;

      UPDATE public.products SET category_id = keeper.id WHERE category_id = lid;

      -- product_categories is pair-keyed: a product already on the keeper
      -- keeps that row, the loser's row goes before it is re-pointed.
      DELETE FROM public.product_categories pc
      WHERE pc.category_id = lid::text
        AND EXISTS (
          SELECT 1 FROM public.product_categories k
          WHERE k.product_id = pc.product_id AND k.category_id = keeper.id::text
        );
      UPDATE public.product_categories SET category_id = keeper.id::text
      WHERE category_id = lid::text;

      -- category_links is pair-keyed too (unique(child_id, parent_id)).
      DELETE FROM public.category_links l
      WHERE (l.child_id = lid::text OR l.parent_id = lid::text)
        AND EXISTS (
          SELECT 1 FROM public.category_links k
          WHERE k.child_id = CASE WHEN l.child_id = lid::text THEN keeper.id::text ELSE l.child_id END
            AND k.parent_id = CASE WHEN l.parent_id = lid::text THEN keeper.id::text ELSE l.parent_id END
        );
      UPDATE public.category_links
      SET child_id  = CASE WHEN child_id  = lid::text THEN keeper.id::text ELSE child_id END,
          parent_id = CASE WHEN parent_id = lid::text THEN keeper.id::text ELSE parent_id END
      WHERE child_id = lid::text OR parent_id = lid::text;

      UPDATE public.categories SET is_deleted = true WHERE id = lid;

      RAISE NOTICE 'categories: % (%) folded into % (store %)',
        grp.n, lid, keeper.id, grp.store_id;
    END LOOP;
  END LOOP;
END $$;

-- Same legacy ids in the join tables: `category_links.parent_id`/`child_id`
-- and `product_categories.category_id` are plain text, so a slug ("dairy")
-- reached the cloud and now points at a category that can never exist there
-- (categories.id is uuid). Devices re-key those rows on launch, so these orphans
-- are dead weight — drop them.
DO $$
DECLARE n int := 0;
BEGIN
  DELETE FROM public.category_links
   WHERE child_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR parent_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'category_links: dropped % legacy-id row(s)', n; END IF;

  DELETE FROM public.product_categories
   WHERE category_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'product_categories: dropped % legacy-id row(s)', n; END IF;
END $$;
