# Deployment & Launch Runbook

Production launch guide for the VBL Signage platform: **backend** (API), **web** console
(RJCorp admin + vendor), and **mobile** app (employees).

> Region: deploy in an **India region** (e.g. AWS `ap-south-1` / Supabase India) for data residency and latency.

---

## 0. Accounts & prerequisites
- Cloud host for the backend container (Render / Railway / AWS ECS-Fargate).
- Managed Postgres with backups + PITR (Supabase Team, or AWS RDS).
- Object storage for photos: Supabase Storage bucket **`signage-photos`** — must be **public-read** — ideally fronted by a CDN.
- Static host/CDN for the web bundle (Vercel / Netlify / S3+CloudFront), or run the web Docker image.
- **Google Play Console** account for the employee app.
- Domains: `signage.vbl.com` (web), `api.signage.vbl.com` (API). TLS on both.
- Sentry (errors) + an uptime monitor on `/health`.

---

## 1. Database
1. Provision the production Postgres. Keep the password free of `@ [ ]` (connection-string encoding).
2. Set `DATABASE_URL` in the backend environment.
3. Apply schema:
   ```bash
   cd backend
   npm ci
   npm run migrate          # applies 001,003,005..015 in order; idempotent (tracks _migrations)
   ```
   > `migrate` deliberately **skips** the `*_seeds*.sql` files — those contain demo accounts with a public password and must never reach production.
4. Load reference data (brands, standard boarding sizes — no demo users/stores):
   ```bash
   npm run seed:reference
   ```

## 2. Backend (API)
1. Generate strong secrets (32+ chars each, different):
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
2. Set env (see `backend/.env.example`):
   `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_STORAGE_BUCKET=signage-photos`,
   `ALLOWED_ORIGINS=https://signage.vbl.com`, `DB_POOL_MAX=10` (raise as needed).
   > In production the app **refuses to boot** on weak/short/duplicate JWT secrets.
3. Build & run (Docker):
   ```bash
   docker build -t signage-api ./backend
   docker run -p 3000:3000 --env-file backend/.env signage-api
   ```
   Run `npm run migrate` once per deploy (release phase) before scaling up instances.
4. Create the first RJCorp super-admin (no public signup):
   ```bash
   ADMIN_EMAIL=admin@vbl.com ADMIN_PASSWORD='<strong-password>' ADMIN_NAME='VBL Admin' npm run create-admin
   ```
   (PowerShell: set `$env:ADMIN_EMAIL=...` etc., then `npm run create-admin`.)
5. Verify `https://api.signage.vbl.com/health` → `{"status":"ok"}`.

## 3. Web console
1. Set `VITE_API_URL=https://api.signage.vbl.com` (build-time).
2. Build & host:
   ```bash
   cd web
   npm ci
   npm run build            # -> dist/  (upload to static host/CDN)
   ```
   or Docker: `docker build --build-arg VITE_API_URL=https://api.signage.vbl.com -t signage-web ./web`
3. Point `signage.vbl.com` at it; confirm login + privilege gating.

## 4. Mobile app (employees)
The app uses native modules — **Expo Go won't work**; build with EAS.
1. Edit `mobile/eas.json` → set the **production** profile's `EXPO_PUBLIC_API_URL` to `https://api.signage.vbl.com`.
2. Build the Android App Bundle:
   ```bash
   cd mobile
   npm ci
   npx eas-cli build -p android --profile production
   ```
3. Upload the `.aab` to Google Play → **Internal testing** (pilot) → **Production**.

## 5. Storage / photos
- Bucket `signage-photos` public-read; add a CDN + lifecycle/retention policy.
- The API only issues presigned upload URLs — it never handles binary data.

## 6. Data onboarding (bulk)
Load real VBL data via the web **Bulk Upload** tabs, in order (imports are batched + idempotent):
**Vendors → Stores (with `vendor_uid`) → Users/employees → Tasks.**

## 7. Observability & backups
- Sentry on backend + web; uptime monitor on `/health`.
- Verify DB backups + PITR and document a restore procedure.

## 8. Pre-launch checklist
- [ ] `NODE_ENV=production`, strong unique JWT secrets set
- [ ] `ALLOWED_ORIGINS` locked to the web domain (CORS)
- [ ] TLS on api + web domains
- [ ] No demo accounts in prod (`alice@`, `bob@`, `rjadmin@`); real admin created
- [ ] Migrations applied + reference data seeded
- [ ] Storage bucket public-read, CDN in front
- [ ] Backups/PITR verified; Sentry + uptime monitoring live
- [ ] Full chain smoke-tested on staging (recee → approve → install → completed)

---

## Built-in production hardening (already in the codebase)
- **CORS** locked to `ALLOWED_ORIGINS` in production.
- **Login rate-limiting** (10 / 15 min per IP) + broad API limiter; `trust proxy` enabled.
- **SSRF guard** on bulk imports — `file_url` must be HTTPS on the Supabase storage origin.
- **Request body cap** (1 MB) — binary never hits the API.
- **JWT secret strength** enforced at boot in production.
- **Bounded task pagination** (`?limit`/`?offset`, capped at 500).
- Helmet headers, append-only `task_steps`, presigned-only photo uploads.
