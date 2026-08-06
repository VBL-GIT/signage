# Signage Field Operations App

## Structure

```
D:\Signage\
  backend/    Node.js + Express + TypeScript REST API
  mobile/     Expo (React Native) mobile app
```

## Quick Start

### 1. Database Setup
```bash
# Create a PostgreSQL database, then:
cd backend
psql $DATABASE_URL -f src/db/migrations/001_init.sql
psql $DATABASE_URL -f src/db/migrations/002_seeds.sql
```

### 2. Backend
```bash
cd backend
cp .env.example .env   # fill in DATABASE_URL, JWT secrets, Supabase keys
npm run dev            # runs on port 3000
```

### 3. Mobile
```bash
cd mobile
# Set EXPO_PUBLIC_API_URL in .env to your backend URL
npx expo start
```

## Seed Credentials (dev only)
| Email | Password | Role |
|---|---|---|
| alice@test.com | password123 | employee |
| bob@test.com | password123 | supervisor |

## Task Types
1. **recee_approval_installation** — Recee photo → supervisor approval → installation photo
2. **installation_only** — Installation photo only, no approval needed
3. **pamphlet_distribution** — Pamphlet count + pincode, optional photo, follow-ups allowed

## API Base
All endpoints under `/api/*`, JWT Bearer token required (except auth routes).
