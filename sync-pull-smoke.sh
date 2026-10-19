#!/usr/bin/env bash
# Sync-pull smoke test: every SYNC_TABLES entry must pull 200 for a real
# account — a single table whose scope/cursor/predicate SQL is wrong 503s the
# WHOLE pull (one cursor, all-or-nothing), which is how catalog core silently
# stopped reaching new devices (variants 42703 on store_id, sale_items
# double-precision cast on the unconditional open predicate).
set -u
source "$(dirname "$0")/backend/.env"
MW=http://127.0.0.1:4000
GOTrue="$SUPABASE_URL/auth/v1"

token() { curl -s -X POST "$GOTrue/token?grant_type=password" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"TestPass123!\"}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))"; }

TEN=$(token owner@tenco.test)
[ -z "$TEN" ] && { echo "FAIL: no TenCo token"; exit 1; }

IDOF() { docker exec supabase_db_retail-sales-management psql -U postgres -d postgres -tA -c "select id from stores where name='$1';"; }
TEN_MAIN=$(IDOF "TenCo Main")
[ -z "$TEN_MAIN" ] && { echo "FAIL: no TenCo Main store"; exit 1; }

pass=0; fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1: expected [$2] got [$3]"; fail=$((fail+1)); fi
}

TABLES="products product_stock customers sales sale_items credits credit_payments price_history categories cash_sessions stock_movements stock_batches suppliers supplier_bank_accounts orders employee_stores product_units product_supplier_costs category_links product_categories items product_suppliers batches variants variant_prices bundles bundle_prices open_orders open_order_lines order_change_requests open_order_events proformats discounts coupons coupon_redemptions promo_audit sale_pickups shifts daily_reports suspended_sales suspended_sale_items standby_hands notifications profiles store_members"

# 1. Every table pulls 200 on its own (scope column must exist, cursor valid).
for t in $TABLES; do
  body=$(curl -s -H "Authorization: Bearer $TEN" "$MW/api/sync/pull?store_id=$TEN_MAIN&device_id=smoke&since=1970-01-01T00:00:00Z&page=0&tables=$t")
  err=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',''))")
  if [ -z "$err" ]; then echo "PASS pull $t"; pass=$((pass+1)); else echo "FAIL pull $t: $err"; fail=$((fail+1)); fi
done

# 2. Full pull (all tables, one cursor) is 200 — the new-device path.
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TEN" "$MW/api/sync/pull?store_id=$TEN_MAIN&device_id=smoke&since=1970-01-01T00:00:00Z&page=0")
check "full pull is 200" 200 "$code"

# 3. Open-only sweep works for the open-item tables.
for t in credits sale_items suspended_sales open_orders order_change_requests orders shifts daily_reports notifications standby_hands; do
  body=$(curl -s -H "Authorization: Bearer $TEN" "$MW/api/sync/pull?store_id=$TEN_MAIN&device_id=smoke&since=1970-01-01T00:00:00Z&page=0&tables=$t&open_only=1")
  err=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',''))")
  if [ -z "$err" ]; then echo "PASS open_only $t"; pass=$((pass+1)); else echo "FAIL open_only $t: $err"; fail=$((fail+1)); fi
done

# 4. Plain pull applies NO open predicates (sale_items regression: the
#    unconditional column-compare 400d every pull).
body=$(curl -s -H "Authorization: Bearer $TEN" "$MW/api/sync/pull?store_id=$TEN_MAIN&device_id=smoke&since=1970-01-01T00:00:00Z&page=0&tables=sale_items")
err=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',''))")
if [ -z "$err" ]; then echo "PASS plain sale_items (no open predicate)"; pass=$((pass+1)); else echo "FAIL plain sale_items: $err"; fail=$((fail+1)); fi

echo "--- $pass passed, $fail failed ---"
[ "$fail" = "0" ]
