# Free-Tier Deploy (no laptop needed)

Host the whole demo on free managed services so your seniors can use it 24/7 while
your PC is off. Uses the **same Supabase database** you already have (with all the
demo data), so there's **no database setup** — just deploy the apps and point them at it.

Stack: **Supabase** (DB+storage, already set up) · **Render** (backend) · **Vercel** (web) · **EAS** (mobile APK).

Accounts you'll create (all free, sign in with GitHub/Google): **GitHub, Render, Vercel, Expo.**

---

## STEP 1 — Put the code on GitHub

The project isn't a git repo yet. From `D:\Signage`:
```powershell
cd D:\Signage
git init
git add .
git commit -m "Signage app"
```
> The `.gitignore` I added keeps your `.env` secrets and `node_modules` out of the commit. Verify none of your `.env` files are staged: `git status` should NOT list `backend/.env`, `web/.env`, or `mobile/.env`.

Create a **new private repo** on github.com (no README), then:
```powershell
git remote add origin https://github.com/<you>/signage.git
git branch -M main
git push -u origin main
```

*(Optional but recommended: rotate the DB password + JWT secrets you shared earlier, and update `backend/.env` before deploying.)*

---

## STEP 2 — Backend on Render

1. render.com → **New + → Blueprint** → connect your GitHub → pick the repo. It reads `render.yaml` and proposes the **signage-api** service.
2. It will ask for the secret env vars (marked `sync:false`). Paste these from your `backend/.env`:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `JWT_REFRESH_SECRET`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   (`NODE_ENV`, `SUPABASE_STORAGE_BUCKET`, `ALLOWED_ORIGINS` are already set by the blueprint.)
3. **Create** → wait for the build (~3–5 min). You'll get a URL like `https://signage-api.onrender.com`.
4. Test it: open `https://signage-api.onrender.com/health` → should show `{"status":"ok"}`.

> No migrations/seeding needed — it connects to your existing Supabase DB.
> Alternative if the Blueprint hiccups: **New + → Web Service** → repo → Root Dir `backend`, Runtime **Docker** → add the same env vars manually.

---

## STEP 3 — Web console on Vercel

1. vercel.com → **Add New → Project** → import the repo.
2. Set **Root Directory = `web`** (Framework auto-detects **Vite**).
3. Add an **Environment Variable**:
   - `VITE_API_URL` = your Render URL, e.g. `https://signage-api.onrender.com`
4. **Deploy** → you get a URL like `https://signage-web.vercel.app`.
   (`vercel.json` handles SPA routing so deep links / refresh work.)

**Then lock CORS (optional but nice):** back in Render → the service → Environment → set
`ALLOWED_ORIGINS = https://signage-web.vercel.app` → save (it redeploys). Leaving it blank also works for a demo (open CORS).

---

## STEP 4 — Mobile app (installable APK) via EAS

1. Point the app at the deployed backend — edit `mobile/eas.json`, in the **preview** profile set:
   ```json
   "EXPO_PUBLIC_API_URL": "https://signage-api.onrender.com"
   ```
2. From `D:\Signage\mobile`:
   ```powershell
   npm install -g eas-cli
   eas login            # create/sign in to a free Expo account
   eas build -p android --profile preview
   ```
3. The build runs in Expo's cloud (~10–15 min). It returns a **download link** (and a QR). Send that link to your seniors — they install the **APK** directly. No Expo Go, no laptop.

---

## STEP 5 — Warm up & share

- Render free sleeps after ~15 min idle. **Before the demo, open the `/health` URL once** to wake it (~50s first load), then it's snappy.
- Share with seniors:
  - **Web console:** your `*.vercel.app` URL
  - **Mobile:** the EAS APK download link
- Logins: `rjadmin@test.com` / `password123` (admin), `bob@test.com` (vendor), `alice@test.com` (employee).

---

## Free-tier limits (fine for a demo)
- **Render free:** sleeps when idle (cold start ~50s); 750 hrs/month. Fine for on-and-off demos.
- **Vercel free:** always-on static hosting, generous limits.
- **EAS free:** limited build minutes/month — enough for a few APK builds.
- **Supabase free:** the DB you're already on.

## Updating later
Push to GitHub → Render + Vercel **auto-redeploy**. For the mobile app, re-run `eas build` and share the new link.

## When you're ready for VBL production
Swap the free tiers for paid/managed equivalents, add a custom domain + TLS, rotate secrets, and lock `ALLOWED_ORIGINS`. Everything else stays the same — see `DEPLOYMENT.md`.
