# Kourro Admin Portal

Standalone internal admin portal for the retail sales management platform: role-based staff
access (super admin / sales / technician), database-backed subscription tiers, seat-based
billing with proration, business customer pipeline, activity log and notifications.

This folder is intentionally **independent** of the rest of the monorepo: its own
`package.json`, `package-lock.json`, `node_modules`, tsconfigs and `.env`. It is not listed
in the root workspaces and shares no source code with `sales-site`, `web-app` or
`mobile-app`.

## Architecture

| Layer | Choice | Why |
| --- | --- | --- |
| UI | React 18 + Vite + react-router + zustand, served on port **5190** | Standalone SPA, proxies `/api` to the API server |
| API | Fastify + TypeScript on port **4200** | All role checks happen server-side, never in the browser |
| Database | Direct `DATABASE_URL` (postgres.js) for every query | RLS is enabled with **no policies** on all `adm_*` tables, so the PostgREST/Anon/Service keys cannot reach them at all; only this server (table owner connection) can |
| Auth | Supabase Auth | Staff JWTs verified with `supabase.auth.getUser()`, then resolved to an active row in `admin_users`. Owner (business customer) JWTs are verified the same way and matched to `businesses.owner_user_id` |
| Shared DB | Same Supabase project, `adm_`-prefixed tables | No cross-schema coupling; the portal's tables are additive |

The client can only ever talk to `GET /api/*` routes through the Vite proxy. Every mutating
route carries a `preHandler` permission check from `server/src/auth.ts`.

### Look & feel

Dark theme that mirrors `mobile-app/src/theme.ts` (`blackPalette`): black canvas, `#1c1c1e`
cards, `#2b2b2b` tiles, ember `#ff4d00` accent with antique gold `#c8a24a` (super-admin chip),
semantic colors from the mobile dark palette (`#4cae7f` / `#d99a2b` / `#e06c5b`), radii
16/12. The brand wordmark and favicons in `public/` are the same files as `sales-site/public/`
(rendered through an AVIF → WebP → PNG `<picture>`), and Inter is self-hosted via
`@fontsource/inter` so the portal has no external font dependency.

Fully responsive: below 900px the rail collapses into an off-canvas drawer (hamburger in the
topbar, scrim overlay, Escape/tap-to-close), grids stack (1080/760/600 breakpoints), toolbars
and action bars wrap, tables scroll horizontally inside their card, and modals/toasts compact
for phone widths (verified at 390×844 and 820×1180 with no horizontal page overflow).

## Getting started

```bash
cd admin-portal
cp .env.example .env          # fill in local Supabase values (see below)
npm install
npm run migrate               # applies db/migrations/*.sql (idempotent, ledger-tracked)
npm run bootstrap             # creates the first super admin from ADMIN_EMAIL/ADMIN_PASSWORD
npm run dev                   # API on :4200 + Vite on :5190
```

Open <http://localhost:5190> and sign in with the bootstrap credentials.

Local `.env` values for this repo's dev stack:

```
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<anon key from backend/.env>
PORT=4200
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=<service role key from backend/.env>
RENEWAL_GRACE_DAYS=7
RENEWING_SOON_DAYS=14
BILLING_JOB_INTERVAL_MS=300000
ADMIN_EMAIL=fenleymenelas@gmail.com
ADMIN_PASSWORD=<the super-admin's password>
EMAIL_REST_URL=http://localhost:54324/api/v1/send
EMAIL_FROM=Kourro Billing <billing@kourro.test>
```

Other commands:

```bash
npm run typecheck             # client + server
npm run build                 # typecheck + vite build + server emit to dist-server/
npm start                     # run the built server (serves API only; host dist/ yourself)
npm run billing:run           # run one billing cycle manually (same code as the scheduler)
```

## Folder structure

```
admin-portal/
├── db/migrations/           # 001_admin_portal.sql — all adm_* tables + seeded tiers
├── scripts/                 # migrate.ts, bootstrap.ts, run-billing.ts
├── public/                  # Kourro wordmark + favicons (copied from sales-site/public)
├── server/src/
│   ├── index.ts             # Fastify app, camelCase reply serializer, billing scheduler
│   ├── auth.ts              # PERMISSIONS matrix, staff + owner auth, requireAdmin()
│   ├── env.ts / db.ts / supabase.ts / errors.ts / serialize.ts
│   ├── routes/              # auth, dashboard, business, seat, tier, admin, log routes
│   └── services/            # business, billing, invoices, payments, seats, money,
│                            # activity, notify, receipt, email, ownerAccount
├── src/                     # React client
│   ├── components/          # ui.tsx primitives, Layout.tsx (rail + toasts + unread badge)
│   ├── pages/               # Login, Dashboard, Businesses, BusinessNew, BusinessDetail,
│                            # Activity, Notifications, Tiers, Admins
│   └── lib/                 # api.ts (typed fetch), supabase.ts, authStore, types, format
├── vite.config.ts           # port 5190, proxy /api → http://localhost:4200
├── tsconfig.json            # client
└── tsconfig.server.json     # server (NodeNext, emits to dist-server/)
```

## Roles & permissions

Roles are rows in `admin_users` (`super_admin` | `sales` | `technician`). The super admin
bypasses every check. Permission keys live in `server/src/auth.ts`.

| Permission | sales | technician | super_admin |
| --- | --- | --- | --- |
| `businesses:register` | ✔ | – | ✔ |
| `payments:record` | ✔ | – | ✔ |
| `appointment:book` | ✔ | – | ✔ |
| `setup:complete` | – | ✔ | ✔ |
| `seats:add` (admin side) | – | ✔ | ✔ |
| `subscription:manage` (renew, upgrade tier) | ✔ | – | ✔ |
| `tiers:manage` | – | – | ✔ |
| `admins:manage` | – | – | ✔ |
| `billing:run` | – | – | ✔ |
| read: dashboard, businesses, activity, notifications | ✔ | ✔ | ✔ |

Guards on the client (`src/App.tsx`) only hide nav items; the API re-checks everything.
Sales and technician cannot see or call tier/admin/billing-run endpoints.

Safety rails (super admin): the last active super admin cannot be demoted or disabled, and
an admin cannot change their own role/status.

## Billing rules (the important part)

Seeded tiers (`adm_tiers`, editable by the super admin, priced in cents HTG):

| Code | Price / month | Base seats | Extra seat / month |
| --- | --- | --- | --- |
| `standard` | 150,000 | 3 | 25,000 |
| `growth` | 300,000 | 6 | 25,000 |

1. **Billing clock starts at setup completion**, never at payment. When a technician
   completes setup, `adm_subscriptions.started_at = now()` and the current period ends at
   `renews_at = now + 1 month`. Earlier payments only produce `initial_period` invoices.
2. **Mid-cycle seat additions are prorated** to the existing renewal date:
   `prorateSeatCents(seatPrice, daysRemaining, daysInMonth)` (`services/money.ts`).
   The renewal date never moves. Proration invoices (`kind = seat_proration`) are issued
   immediately and settled FIFO against any credit balance.
3. **Renewal is one lump sum**: tier price + `extra_seats × seat_price_cents`, invoiced at
   renewal with `due_at = renews_at + RENEWAL_GRACE_DAYS`.
4. **Grace → expiry**: an open `renewal` invoice still unpaid after the grace period moves
   the subscription to `expired` (admins are notified). Expiry does **not** void the
   invoice.
5. **Reactivation**: once the business's balance reaches zero (all open invoices covered by
   applied payments), the subscription returns to `active` with a fresh period from the
   payment/now — logged as `subscription.reactivated`.
6. **Balance** = sum of open invoices − unapplied payments. Positive ⇒ the customer owes
   money; negative ⇒ credit.
7. **`renewing_soon`** = `active` and `renews_at ≤ now + RENEWING_SOON_DAYS` (default 14 d).
8. **Scheduler**: `server/src/index.ts` runs `runBillingCycle()` every
   `BILLING_JOB_INTERVAL_MS` (first run shortly after boot) and on demand via
   `POST /api/billing/run` (super admin) or `npm run billing:run`.
9. **Manual renewal** (`POST /businesses/:id/renew`, sales/super): runs the same
   lump-sum renewal immediately. The billed period starts at `max(renews_at, now)` —
   an overdue subscription restarts from today, an early renewal pre-pays the period
   after the current one (`current_period_start` is only touched when the old
   `renews_at` has passed). `renews_at` moves forward one interval; the invoice
   (`kind = renewal`) is due at the new period end + grace. Guards: subscription must
   be `active`, and an already-open renewal invoice blocks a second one
   (`409 renewal_invoice_open`) so the same period can never be billed twice.
10. **Tier upgrades** (`POST /businesses/:id/tier`, or owner self-service — see the
    contract below): the price difference is prorated for the days left in the current
    period and invoiced immediately (`kind = tier_upgrade`); the renewal date never
    moves, and the subscription snapshot (tier, tier price, seat price, included seats)
    switches at once. Same tier = idempotent no-op; a same-or-cheaper tier returns
    `400 tier_downgrade_not_supported` (no credit path through this flow); a tier with a
    **different billing interval or currency** returns `400` (switching monthly ↔ yearly
    needs its own flow).
11. **Payment receipts**: recording a payment (`POST /businesses/:id/payments`)
    immediately after the commit emails `adm_businesses.owner_email` a receipt with the
    breakdown — every invoice the payment settled (FIFO, kind + number + amount applied),
    method, reference, total applied and the balance afterwards. Transport is a
    Mailpit/Inbucket-compatible REST endpoint (`EMAIL_REST_URL`, sender `EMAIL_FROM`;
    local dev: `http://localhost:54324/api/v1/send`). If unconfigured or the send fails,
    the payment still succeeds and the response reports
    `receipt: { sent, to, error? }`.
 12. **Currency**: every payment is stored in its subscription's currency (tier
     currency as fallback). Dashboard KPIs (outstanding balance, credits, collected
     this month) report in **USD** — amounts held in other currencies are converted
     for display only at a fixed rate (130 HTG = 1 USD, `FX_TO_USD` in
     `dashboardRoutes.ts`); stored rows and all other pages keep their original
     currency.

Pipeline statuses: `prospect → paid → setup_scheduled → setup_complete` (`cancelled` is
allowed at any point). The dashboard and list filters group on these.

## API

All routes are prefixed `/api`. All responses are camelCase JSON (enforced by a global
reply serializer). Staff routes need `Authorization: Bearer <staff supabase JWT>`.

| Method | Path | Access |
| --- | --- | --- |
| GET | `/health` | public |
| GET | `/me` | any admin |
| GET | `/dashboard` | any admin |
| GET | `/businesses` (filter/stage, billing status, balance) | any admin |
| POST | `/businesses` | `businesses:register` |
| GET | `/businesses/:id` | any admin |
| POST | `/businesses/:id/payments` | `payments:record` |
| POST | `/businesses/:id/appointment` | `appointment:book` |
| POST | `/businesses/:id/setup` | `setup:complete` |
| POST | `/businesses/:id/seats` | `seats:add` (technician) |
| POST | `/businesses/:id/seats/self-service` | **business owner token** (see below) |
| POST | `/businesses/:id/renew` | `subscription:manage` (sales) |
| POST | `/businesses/:id/tier` | `subscription:manage` (sales) |
| POST | `/businesses/:id/tier/self-service` | **business owner token** (see below) |
| GET/POST/PATCH/DELETE | `/tiers`, `/tiers/:id` | `tiers:manage` (super) |
| GET/POST/PATCH | `/admins`, `/admins/:id` | `admins:manage` (super) |
| GET | `/activity` | any admin |
| GET | `/notifications`, `/:id/read`, `/read-all` | any admin |
| POST | `/billing/run` | `billing:run` (super) |
| GET | `/config` | any admin (grace/renewing-soon/seat prices for the UI) |

`POST /businesses/:id/payments` responds with `{ payment, balance, pipelineStatus,
receipt }` where `receipt = { sent, to, error? }` describes the owner email (rule 11).

## Customer-portal integration contract (seat self-service)

The business owner dashboard (outside this folder) can let customers change their own seat
count using this endpoint:

```
POST /api/businesses/:id/seats/self-service
Authorization: Bearer <owner's supabase access token>
Content-Type: application/json

{ "seats": 8 }
```

- `:id` is the `adm_businesses.id` (UUID) — the same id exposed to the owner's dashboard.
- The server verifies the JWT with Supabase Auth and requires
  `businesses.owner_user_id === user.id`; a staff token or another owner gets 403.
- `seats` is the **desired total seat count**, not an increment (`{ "seats": 10 }` = "I want
  10 seats in total"). The call is **idempotent**: sending the current total is a no-op
  (200, nothing charged, nothing logged). Seat counts can only go up through this endpoint —
  asking for fewer seats than the business currently has returns
  `400 seats_reduction_not_supported`.
- There is **no approval gate**: increases apply immediately — proration invoice issued
  (price is `extra × seat_price_cents` prorated to the existing renewal date, which never
  moves), balance settled FIFO, `seats.added.self_service` activity entry, and a
  notification fanned out to **all** admins (exactly one per change, none for no-ops).
- Response: `{ seatsAdded, proratedCents, totalSeats, paidSeats, renewsAt, balanceCents }`.
- Errors: `401` no/invalid owner token, `403` not this business's owner, `404` unknown
  business, `400` bad seat count or reduction, `409 subscription_not_active` (seats are
  frozen while expired).

Admin-side equivalent: `POST /api/businesses/:id/seats` with a technician/super token and
body `{ seats }` where `seats` is **the number to add** (used by the "Add seats" dialog) —
same proration/notification semantics, actor recorded as the admin.

## Customer-portal integration contract (tier self-service)

The same customer dashboard can let owners **upgrade their own plan**:

```
POST /api/businesses/:id/tier/self-service
Authorization: Bearer <owner's supabase access token>
Content-Type: application/json

{ "tierId": "8f2c…" }      // adm_tiers.id — list available tiers via GET /api/tiers
```

- Same authentication/ownership rules as seats: owner JWT required, staff tokens or other
  owners get `403`, unknown business `404`.
- The call is **idempotent**: sending the current tier is a no-op (200, nothing charged,
  nothing logged).
- **Upgrades only**: a same-or-cheaper tier returns `400 tier_downgrade_not_supported`.
  Interval/currency mismatches return `400 interval_mismatch` / `400 currency_mismatch`.
- No approval gate: the price difference is prorated for the days left, invoiced
  immediately (`kind = tier_upgrade`, settled FIFO against any credit), the renewal date
  never moves, `subscription.upgraded.self_service` activity is logged, and **all** admins
  get a notification (exactly one per change, none for no-ops).
- Response: `{ changed, tierId, tierName, previousTierName, tierPriceCents, upgradeCents,
  baseSeats, totalSeats, paidSeats, renewsAt, balanceCents }`.
- Errors: `401` no/invalid owner token, `403` not the owner, `404` unknown business,
  `400 tier_not_available` (unknown/inactive tier id), `409 subscription_not_active`
  (tiers are frozen while expired).

Admin-side equivalent: `POST /api/businesses/:id/tier` with a sales/super token (used by
the "Upgrade tier" dialog), and `POST /api/businesses/:id/renew` to run the lump-sum
renewal on demand — both recorded with the admin as actor.

## Database

All tables are created by `db/migrations/001_admin_portal.sql`, are RLS-enabled with **no
policies**, and are tracked in `adm_schema_migrations` so `npm run migrate` is idempotent:

`admin_users`, `adm_tiers`, `adm_businesses`, `adm_subscriptions`, `adm_invoices` (+
`adm_invoice_seq`), `adm_payments`, `adm_payment_applications`, `adm_activity_log`,
`adm_notifications`.

During setup the portal also writes the shared operational tables the rest of the platform
expects: `profiles` → `organizations` → `profiles.organization_id` → `stores` →
`store_members`, plus a best-effort shared `subscriptions` row (plan_code only — the
`adm_subscriptions` row is authoritative for billing).

The owner's account is created through `supabase.auth.admin.createUser()` with a temporary
password entered by the technician in the setup dialog; the plaintext is never stored.

## Verification performed

- `npm run typecheck` and `npm run build` — clean.
- API smoke test (full flow as each role): register → pay → appointment → setup → owner
  login → technician seat add (prorated, renewal unchanged) → owner self-service seats
  (no approval, admin notifications) → activity log coverage → tier/admin permission
  boundaries → last-super-admin guard. All green.
- Billing cycle test: backdated renewal produced a single lump-sum invoice computed as
  `tier_price + extra_seats × seat_price` (dynamic — seat drift changes the number);
  unpaid past grace → `expired` + notification; payment → `reactivated`, balance zero.
  All green.
- Renew + tier-upgrade contract test (on a fresh fixture built from the current tiers):
  manual renew (lump sum, `renews_at` + one interval, early renewal leaves
  `current_period_start` untouched, activity + sales notification), second renew blocked
  (`409 renewal_invoice_open`), owner token rejected, admin upgrade (prorated
  `tier_upgrade` invoice, renewal date unchanged, business + subscription tier snapshot
  updated), downgrade/unknown-tier rejected, owner self-service upgrade (same-tier
  no-op, staff/bad token rejected, exactly one admin notification, activity attributed
  to the owner), cleanup settles the balance. All green.
- Payment receipt test: after setup, a business owing the initial period + seat
  proration + renewal invoices pays the full balance → response
  `receipt = { sent: true, to: owner }`, and local Mailpit holds a
  `Payment receipt — …` email whose text lists every applied invoice (number + kind +
  amount), method, reference, total applied and the balance settled (HTML table too).
  A prospect with no owner email records the payment with `receipt.sent = false`.
  All green (26 asserts).
- Test accounts: there is exactly **one super admin** (`fenleymenelas@gmail.com`, from
  `.env` `ADMIN_EMAIL`), and all automated tests sign in as it; `sales@`/`tech@` staff
  accounts and fixture owner accounts are created by the flows themselves.
- Headless Chrome E2E against the real UI: super admin (login, dashboard, list, detail with
  invoices/payments/activity, activity, notifications, tiers, admins) plus role checks for
  sales and technician (nav hides super-only sections, direct `/tiers` `/admins` URLs hit the
  guard, 0 JS errors), and the subscription actions on the detail page — "Record payment"
  visible after setup (modal opens with the receipt note and closes), "Renew now" and
  "Upgrade tier" previews open, show their preview copy and cancel without hitting the
  API. All green (18 checks).
- Self-service contract test: total-count increase (proration, renewal date unchanged),
  idempotent repeat (no charge/log), reduction → `400 seats_reduction_not_supported`,
  staff token → `403`, invalid token → `401`, exactly one admin notification per change,
  balance settled back to zero. All green.
- Mobile/tablet pass (headless Chrome at 390×844 and 820×1180): every route renders with
  `innerWidth === scrollWidth` (no horizontal overflow), a DOM audit finds zero elements
  outside the viewport (tables excluded — they scroll inside `.table-wrap`), the drawer
  opens/closes with scrim, the Add-seats modal fits (12→378px), 0 JS errors. Fixed along the
  way: grid items needed `min-width: 0` so 600px-min tables no longer inflate the layout
  viewport, and the topbar role chip is `white-space: nowrap`. The payment modal with an
  owed balance was audited separately on an owed business: the breakdown block renders its
  invoice lines + total, the amount defaults to the owed amount, and everything stays
  inside 390px (screenshot in `/tmp/admin-mobile-shots/payment-breakdown.png`).
- Vector logo: the KOURRO wordmark and the favicon "K" badge are rebuilt from scratch as
  outlined Archivo Black paths (OFL, `scripts/brand/`) — `public/logo.svg`,
  `public/logo-white.svg`, `public/logo-dark.svg`, `public/favicon.svg` (same files in
  `sales-site/public/`), replacing the earlier blurry auto-traced artwork. `BrandLogo` and
   the sales-site nav and footer render `/logo.svg` (orange — the footer flips to a cream
   background in dark mode, so the orange wordmark is the one variant that reads on both),
   and both `index.html`s link `favicon.svg` first (PNG favicons kept as
   fallback). `/logo-white.svg` still carries a black keyline (`stroke="#15120b"` painted
   under the fill via `paint-order="stroke"`, 5/2 units on wordmark/tagline) so it stays
   legible on light and dark backgrounds wherever it is used. Everything is regenerated by
   `node scripts/generate-brand.mjs`, which also
  rewrites the PNG/WebP/AVIF sets, the app icons (`kourro-logo.png`, iOS 1024) and the
  mobile wordmark. Verified with previews at 26–600px, admin-portal typecheck, and
  sales-site `tsc`.

## Known gaps / follow-ups

- If a subscription expires **before** the renewal invoice is generated, seat proration
  invoices already issued stay on the balance, but no proration is generated afterwards
  while expired (by design: seats are frozen when not active).
- Renewal invoices are generated exactly once per period (`renewal` kind is unique per
  `period_start`); double-clicking "run billing" is safe but there is no distributed lock
  beyond the row-level check — running two API instances would need advisory locks.
- Payments are recorded manually (transfer/receipt references); no payment-provider webhook
  ingestion yet. The owner receipt email uses a Mailpit/Inbucket-compatible REST
  transport (`EMAIL_REST_URL`) — point it at a real mail API (or add SMTP) for
  production; send failures are reported in the response and logged, never blocking
  the payment.
- Owner-side seat self-service is server-ready but the customer dashboard itself lives
  outside this folder (contract above).
- Currency follows each subscription (tiers are USD today, the legacy Magazen snapshot
  is HTG) and dashboard KPIs are reported in USD with HTG converted at a fixed
  130 = 1 USD display rate (rule 12); there is no live FX feed yet.
- The wordmark/favicon everywhere are vector (`logo.svg`, `logo-white.svg`, `logo-dark.svg`,
  `favicon.svg`); the customer portal and mobile app use PNGs rasterised from the same
  artwork (`kourro-logo.png`, `kourro-wordmark.png`).
