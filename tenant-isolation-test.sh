#!/usr/bin/env bash
# Tenant-isolation smoke test against the local middleware + local Supabase.
set -u
source "$(dirname "$0")/backend/.env"
MW=http://127.0.0.1:4000
GOTrue="$SUPABASE_URL/auth/v1"

token() { curl -s -X POST "$GOTrue/token?grant_type=password" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"TestPass123!\"}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))"; }

TEN=$(token owner@tenco.test)
OTH=$(token owner@otherco.test)
FJ=$(token owner@fjbusiness.ht 2>/dev/null)
[ -z "$TEN" ] && { echo "FAIL: no TenCo token"; exit 1; }
[ -z "$OTH" ] && { echo "FAIL: no OtherCo token"; exit 1; }

IDOF() { docker exec supabase_db_retail-sales-management psql -U postgres -d postgres -tA -c "select id from stores where name='$1';"; }
TEN_MAIN=$(IDOF "TenCo Main"); TEN_BRANCH=$(IDOF "TenCo Branch"); OTH_MAIN=$(IDOF "OtherCo Main")
PETYON=8bdb5227-619e-5841-952a-c5bc6c4b4d57

pass=0; fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1: expected [$2] got [$3]"; fail=$((fail+1)); fi
}

# 1. No token → 401
code=$(curl -s -o /dev/null -w "%{http_code}" "$MW/api/sync/pull?store_id=$TEN_MAIN&since=1970-01-01T00:00:00Z")
check "no-token pull is 401" 401 "$code"

# 2. Garbage token → 401
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer not.a.jwt" "$MW/api/sync/pull?store_id=$TEN_MAIN&since=1970-01-01T00:00:00Z")
check "bad-token pull is 401" 401 "$code"

# 3. Owner pulls own store → 200
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TEN" "$MW/api/sync/pull?store_id=$TEN_MAIN&since=1970-01-01T00:00:00Z")
check "own-store pull is 200" 200 "$code"

# 4. TenCo owner pulls OtherCo store → 403
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TEN" "$MW/api/sync/pull?store_id=$OTH_MAIN&since=1970-01-01T00:00:00Z")
check "foreign-store pull is 403" 403 "$code"

# 5. TenCo owner pulls a store of no org at all → 403
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TEN" "$MW/api/sync/pull?store_id=$PETYON&since=1970-01-01T00:00:00Z")
check "legacy-store pull is 403" 403 "$code"

# 6. TenCo pull contains ONLY TenCo-scoped rows: every store_id in the payload
#    must be one of the caller's stores; every organization_id must be TenCo's.
#    Seed one product per tenant store so the pull has something to carry.
TEN_ORG=$(docker exec supabase_db_retail-sales-management psql -U postgres -d postgres -tA -c "select id from organizations where name='TenCo';")
OTH_ORG=$(docker exec supabase_db_retail-sales-management psql -U postgres -d postgres -tA -c "select id from organizations where name='OtherCo';")
docker exec supabase_db_retail-sales-management psql -U postgres -d postgres -q -c "
insert into products (store_id, organization_id, name, sku, selling_price, stock_quantity)
select s.id, s.organization_id, 'TenCo Soap', 'TEN-SOAP', 100, 10 from stores s where s.name='TenCo Main'
on conflict do nothing;
insert into products (store_id, organization_id, name, sku, selling_price, stock_quantity)
select s.id, s.organization_id, 'OtherCo Soap', 'OTH-SOAP', 200, 20 from stores s where s.name='OtherCo Main'
on conflict do nothing;" >/dev/null
summary=$(curl -s -H "Authorization: Bearer $TEN" "$MW/api/sync/pull?store_id=$TEN_MAIN&since=1970-01-01T00:00:00Z" | python3 -c "
import sys, json
d = json.load(sys.stdin)
bad_store = bad_org = rows = 0
stores_ok = {'$TEN_MAIN', '$TEN_BRANCH'}
for ch in d.get('changes', []):
    rows += 1
    r = ch.get('record') or {}
    sid = r.get('store_id')
    oid = r.get('organization_id')
    if sid is not None and sid not in stores_ok: bad_store += 1
    if oid is not None and oid != '$TEN_ORG': bad_org += 1
print(f'{rows} {bad_store} {bad_org}')
")
read -r rows bad_store bad_org <<< "$summary"
check "TenCo pull has rows" "yes" "$([ "$rows" -gt 0 ] && echo yes || echo no)"
check "TenCo pull: no foreign store_id" 0 "$bad_store"
check "TenCo pull: no foreign organization_id" 0 "$bad_org"

# 7. Push targeting another tenant's store → 403, nothing written.
CUS=$(python3 -c "import uuid; print(uuid.uuid4())")
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$MW/api/sync/push" -H "Authorization: Bearer $TEN" -H "Content-Type: application/json" -d "{
  \"store_id\": \"$OTH_MAIN\", \"device_id\": \"curl-test\", \"changes\": []}")
check "push body targeting foreign store is 403" 403 "$code"

# 8. Push customer against OWN store: organization_id must land as TenCo.
resp=$(curl -s -X POST "$MW/api/sync/push" -H "Authorization: Bearer $TEN" -H "Content-Type: application/json" -d "{
  \"store_id\": \"$TEN_MAIN\", \"device_id\": \"curl-test\",
  \"changes\": [{\"table\": \"customers\", \"operation\": \"update\", \"record\": {
    \"id\": \"$CUS\", \"name\": \"TenCoCustomer\", \"phone\": null, \"address\": null,
    \"notes\": null, \"credit_limit\": 0, \"is_prospect\": 0, \"is_deleted\": 0,
    \"lamport_clock\": 1, \"updated_at\": \"2026-10-09T21:00:00.000Z\"
  }}]
}")
echo "$resp" | grep -q "inserted\|updated" && check "own-store customer push accepted" ok ok || { echo "FAIL customer push: $resp"; fail=$((fail+1)); }
got_org=$(docker exec supabase_db_retail-sales-management psql -U postgres -d postgres -tA -c "select organization_id from customers where id='$CUS';")
check "customer stamped with caller's org" "$TEN_ORG" "$got_org"

# 9. OtherCo owner pulls: must NOT see TenCoCustomer.
leak=$(curl -s -H "Authorization: Bearer $OTH" "$MW/api/sync/pull?store_id=$OTH_MAIN&since=1970-01-01T00:00:00Z" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('leak' if any((c.get('record') or {}).get('name')=='TenCoCustomer' for c in d.get('changes',[])) else 'clean')
")
check "OtherCo pull has no TenCo customer" clean "$leak"

# 10. A non-owner cannot push store_members (roster is owner/admin only).
# 11. A cashier only reaches their own store: the branch (no membership) is 403.
CASH=$(token cashier@tenco.test)
if [ -n "${CASH:-}" ]; then
  st=$(curl -s -X POST "$MW/api/sync/push" -H "Authorization: Bearer $CASH" -H "Content-Type: application/json" -d "{
    \"store_id\": \"$TEN_MAIN\", \"device_id\": \"curl-test\",
    \"changes\": [{\"table\": \"store_members\", \"operation\": \"update\", \"record\": {
      \"id\": \"$(python3 -c 'import uuid; print(uuid.uuid4())')\", \"store_id\": \"$TEN_MAIN\",
      \"user_id\": \"d26f93bf-07b3-4d47-9bb0-bd64054ef5f8\", \"role\": \"owner\",
      \"created_at\": \"2026-10-09T21:00:00.000Z\"
    }}]
  }" | python3 -c "import sys,json; r=json.load(sys.stdin).get('results',[{}])[0]; print(r.get('status',''))")
  check "cashier store_members push refused" "error:forbidden_roster" "$st"
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $CASH" "$MW/api/sync/pull?store_id=$TEN_BRANCH&since=1970-01-01T00:00:00Z")
  check "cashier pull of sibling store is 403" 403 "$code"
else
  echo "SKIP roster tests (no cashier@tenco.test token)"
fi

# 12. Owner roster edit: promote the cashier to manager (pair-keyed upsert).
st=$(curl -s -X POST "$MW/api/sync/push" -H "Authorization: Bearer $TEN" -H "Content-Type: application/json" -d "{
  \"store_id\": \"$TEN_MAIN\", \"device_id\": \"curl-test\",
  \"changes\": [{\"table\": \"store_members\", \"operation\": \"update\", \"record\": {
    \"id\": \"$(python3 -c 'import uuid; print(uuid.uuid4())')\", \"store_id\": \"$TEN_MAIN\",
    \"user_id\": \"d26f93bf-07b3-4d47-9bb0-bd64054ef5f8\", \"role\": \"manager\",
    \"created_at\": \"2026-10-09T21:00:00.000Z\"
  }}]
}" | python3 -c "import sys,json; r=json.load(sys.stdin).get('results',[{}])[0]; print(r.get('status',''))")
check "owner store_members edit accepted" updated "$st"
role_now=$(docker exec supabase_db_retail-sales-management psql -U postgres -d postgres -tA -c "select role from store_members where user_id='d26f93bf-07b3-4d47-9bb0-bd64054ef5f8' and store_id='$TEN_MAIN';")
check "membership role updated" manager "$role_now"
count_now=$(docker exec supabase_db_retail-sales-management psql -U postgres -d postgres -tA -c "select count(*) from store_members where user_id='d26f93bf-07b3-4d47-9bb0-bd64054ef5f8' and store_id='$TEN_MAIN';")
check "no duplicate membership row" 1 "$count_now"

echo; echo "== $pass passed, $fail failed =="
exit $fail
