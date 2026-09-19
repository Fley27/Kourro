# Retail Sales Management — Haitian Store OS

> **"Bati yon biznis ki ap siviv ou e pase bay timoun ou"**  
> Build a business that will survive you and pass to your children.

Hybrid offline/online retail management for Haitian stores. Offline-first, Creole interface, credit tracking, price history, multi-store, profit analysis.

## Architecture

```
retail-sales-management/
├── packages/
│   ├── shared-types/   # Shared TypeScript types (JS+TS usable)
│   └── sync-engine/    # CRDT + LAN P2P sync logic
├── backend/            # Supabase + PostgreSQL schema, migrations, seed
├── middleware/         # Node.js Fastify + Redis (sync arbiter)
├── mobile-app/         # React Native (Expo) + SQLite offline-first
└── web-app/            # React PWA (Vite) + Supabase dashboard
```

### Stack

| Layer | Tech |
|-------|------|
| Mobile | React Native (Expo) + expo-sqlite + TypeScript |
| Web | React 18 + Vite + PWA + Supabase |
| Middleware | Fastify + Redis + TypeScript |
| DB | PostgreSQL (Supabase) |
| Sync | CRDT (LWW) + LAN P2P (mDNS/WebSocket) + Cloud (Postgres) |

## Quick Start

```bash
# 1. Install deps (workspaces)
npm install

# 2. Backend - Supabase
cd backend && cp .env.example .env
npm run migrate && npm run seed

# 3. Middleware
cd ../middleware && cp .env.example .env
npm run dev # http://localhost:4000

# 4. Web
cd ../web-app && cp .env.example .env
npm run dev # http://localhost:5173

# 5. Mobile
cd ../mobile-app && cp .env.example .env
npx expo start
```

## Sync Model

Two layers separated:
1. **Same store, multiple registers, offline** → LAN P2P sync (local hub via WebSocket/mDNS, CRDT merge)
2. **Internet available** → Cloud converge via `middleware` → `Postgres (Supabase)` as source of truth

Every write gets `id (UUIDv7)`, `store_id`, `device_id`, `lamport_clock`, `updated_at`. Conflicts resolved via Last-Write-Wins + vector clocks in `packages/sync-engine`.

## Folders are Independent

Each folder has its own `package.json`, `tsconfig.json`, `.env.example` — edit/refactor without touching others. Shared code via `packages/*`.

## Deployment

- Middleware → Railway / Render
- Web → Vercel
- Mobile → EAS Build
- DB → Supabase Cloud
