-- 026: remove local-only shadow staff + nothing else.
--
-- Four test staff rows (Jean-Louis Dupont, Marie-Claire Fontaine, Robenson
-- Saintil, Tatiana Beaumont) were inserted with locally-minted ids that match
-- no auth.users row. They can never sync (store_members.user_id and
-- profiles.id both reference auth.users), they shadow the real accounts in
-- team lists, and their queued roster rows fail forever server-side. Delete
-- by exact id: a no-op on any database that never had them.
--
-- Idempotent-ish by convention (see 023 / backend/src/migrate.ts).

delete from public.employees
where id in (
  'a215eb97-78dd-5306-91cc-cda784cd8b21',
  '6a1f6483-bfcb-53de-9b2f-99eff41d09e6',
  '48b5f14a-c301-5e41-9b73-79bb67b22a85',
  '36bd2f3a-f7bf-59c5-9990-cb14e2190118'
);
