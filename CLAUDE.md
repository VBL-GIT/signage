# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Signage field operations app. Employees visit assigned stores to install signage (boardings/pamphlets). Three task workflows with a supervisor approval layer.

**Task types & status flows:**
- `recee_approval_installation`: pending → recee_submitted → recee_approved/rejected → installed → completed
- `installation_only`: pending → completed (single install step)
- `pamphlet_distribution`: pending → completed (count + pincode, follow-ups allowed)

Status machine is enforced server-side in `backend/src/services/tasks.service.ts` — the mobile client only calls step endpoints.

## Architecture

```
backend/   Express + TypeScript REST API (port 3000)
mobile/    Expo SDK 56 + expo-router (React Native) — EMPLOYEE ONLY
web/       Vite + React + TS SPA (port 5173) — RJCORP ADMIN & VENDOR
```

**Client split:** field employees use the Expo **mobile** app (camera/GPS recee & install flows). RJCorp-admin and vendor users use the **web** console (task review/approval, assignment, onboarding, bulk upload). Both talk to the same backend API. The web Layout blocks `employee` logins; the mobile app has no admin/vendor screens. (Future: the vendor web console may be wrapped for mobile.)

### Backend

Routes mounted in `src/app.ts`: `/api/auth`, `/api/stores`, `/api/tasks`, `/api/uploads`, `/api/*` (reference data).

Request flow: `route → validate(zod) → authenticate(JWT) → requireRole → controller → service → pg pool`

`task_steps` is an append-only audit log — never update rows, only insert. Each step records lat/long, timestamp, and photo_url.

Photos use presigned URLs via Supabase Storage — the API server never handles binary data.

`AuthRequest` (from `middleware/auth.ts`) extends Express `Request` with `user?: { id, role, email }`. All controllers use `AuthRequest`, not `Request`. Routes cast handlers with `as any` to avoid TypeScript complaints.

### Mobile (employee only)

Navigation: expo-router file-based routing. Root `_layout.tsx` handles auth gating; `components/system/AppGate.tsx` blocks the app until location permission/services are on (employee) and shows an offline blocker (NetInfo).
- `(auth)/` — login
- `(app)/(tasks)/` — task list + detail (tab)
- `(app)/(task-flows)/` — full-screen flows: recee, install (hidden from tabs)
- `(app)/(profile)/` — user profile (tab)

Tabs are Tasks + Profile only. There are no onboarding/stores/approve/assign screens — those moved to the web console.

State: Zustand for auth. Tokens stored in `expo-secure-store` on native, falling back to `localStorage` on web.

API layer: `services/api.ts` is the axios instance with JWT refresh interceptor. All API modules import from it.

### Web (RJCorp admin & vendor)

Vite + React + react-router. `VITE_API_URL` (in `web/.env`) points at the backend.
- `src/api/` — axios client (JWT + refresh, localStorage) and typed endpoint functions
- `src/store/auth.ts` — Zustand auth
- `src/components/Layout.tsx` — sidebar nav + role gate (blocks `employee`)
- `src/pages/` — Login, Tasks, TaskDetail, Approve (per-signage accept/reject + brand/size), Assign, Onboarding (tabbed: vendor/store/account/task/bulk)
- `src/components/AnnotatedImage.tsx` — renders recee photos with the freehand annotation overlay (SVG)

## Commands

### Backend
```bash
cd backend
npm run dev          # nodemon + ts-node (watches src/)
npm run build        # tsc → dist/
npm run start        # node dist/server.js
npx tsc --noEmit     # type-check without emitting
```

### Web (RJCorp admin & vendor console)
```bash
cd web
npm run dev          # vite dev server on http://localhost:5173
npm run build        # tsc -b + vite build → dist/
npm run typecheck    # tsc --noEmit
# web/.env: VITE_API_URL=http://localhost:3000
```

### Database
```powershell
# Always quote the connection string in PowerShell
psql "postgresql://postgres:PASSWORD@db.HOST.supabase.co:5432/postgres" -f backend/src/db/migrations/001_init.sql
psql "postgresql://postgres:PASSWORD@db.HOST.supabase.co:5432/postgres" -f backend/src/db/migrations/002_seeds.sql

# Fix seed passwords (bcrypt hash gets mangled by PowerShell — use this script instead)
cd backend
npx ts-node scripts/fix-passwords.ts

# Seed test tasks
npx ts-node scripts/seed-tasks.ts
```

### Mobile
```bash
cd mobile
npx expo start --android   # physical Android device via USB (recommended)
npx expo start --web       # browser only — camera/GPS/SecureStore behave differently
npx tsc --noEmit           # type-check
```

## Environment

Backend `.env` requires: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_STORAGE_BUCKET`.

Mobile `.env`: `EXPO_PUBLIC_API_URL` — use LAN IP (not localhost) for physical devices e.g. `http://192.168.x.x:3000`.

## Dev Seed Data

| Email | Password | Role |
|---|---|---|
| alice@test.com | password123 | employee |
| bob@test.com | password123 | supervisor |

3 stores assigned to Alice, 3 brands, 4 standard boarding sizes. Run `seed-tasks.ts` to create one task of each type assigned to Alice.

## Key Constraints

- **Camera only** — no gallery/image picker. All photo capture uses `expo-camera` (`CameraView.takePictureAsync`). This is intentional for proof-of-presence.
- GPS is captured client-side at submission time and sent in the request body. The server records it as-is.
- Roles in JWT payload: `employee` | `supervisor`. The `vendor_id` FK on users/stores exists for future multi-vendor support but is NULL in v1.
- Read Expo v56.0.0 docs at https://docs.expo.dev/versions/v56.0.0/ — APIs may differ from older versions.
- **Do not test on web** — expo-camera and expo-secure-store are native-only. Use a physical Android device or Android Studio emulator.
- **PowerShell gotchas** — `$` in strings gets interpreted as variables. Always quote connection strings. Use Node scripts instead of psql `-c` for any value containing `$` (e.g. bcrypt hashes).
- **`&&` does not work in PowerShell** — use `;` to chain commands.

## Supabase

- Project URL and service key are in `backend/.env`
- Storage bucket: `signage-photos` (must be public)
- Database password must not contain special characters like `@`, `[`, `]` to avoid URL encoding issues in connection strings
