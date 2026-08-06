# Public Testing (Path B — Cloudflare tunnels)

Expose your **local** backend + web + mobile over the internet so seniors can test
from any device/network. No deploy, no firewall changes (tunnels are outbound).
The database is already on Supabase (cloud), so nothing to host there.

Prereq (one-time): `winget install --id Cloudflare.cloudflared` (already installed on this machine).

---

## Start everything (one command)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-public-test.ps1
```

This will:
1. Open HTTPS tunnels for the **backend** (:3000) and **web** (:5173).
2. Write the public URLs into `web/.env`, `mobile/.env`, and `backend/.env` automatically.
3. Launch the backend and web dev servers in new windows.
4. Print the **Web console URL** to share with your seniors.

Then, for the **mobile app**, open a new terminal:
```powershell
cd mobile
npx expo start --tunnel
```
Seniors install **Expo Go** (Play Store), open it, and scan the QR — works on any network.

---

## What to share with seniors
- **Web console (RJCorp/Vendor):** the `https://…trycloudflare.com` WEB url printed by the script — opens in any browser.
- **Mobile (Employees):** Expo Go + scan the QR from `expo start --tunnel`.
- **Logins:** the seed accounts (e.g. `rjadmin@test.com` / `password123`) or any account you onboard.

## Stop everything
```powershell
powershell -ExecutionPolicy Bypass -File scripts\stop-public-test.ps1
```
…then close the backend / web / expo windows.

---

## Important notes
- **Free quick-tunnel URLs change every restart.** Each session: re-run `start-public-test.ps1` (it rewrites the env files) and restart `expo start --tunnel`. The web/backend windows pick up the new env on restart.
- **Keep the laptop awake & plugged in** — everything is served from it.
- **Credential emails:** `APP_WEB_URL` is auto-set to the current web tunnel URL, so login links in emails point to the right place for that session.
- **Security:** this exposes your machine to anyone with the URL. Only share with your testers, and stop the tunnels when done. Dev CORS intentionally allows all origins for this.
- **For a stable, always-on URL** (real pilot rather than ad-hoc testing), deploy per `DEPLOYMENT.md` and/or use a named Cloudflare tunnel with your own domain.

## Mobile alternative — installable APK
Instead of Expo Go, build a real APK seniors install directly:
```powershell
cd mobile
npx eas-cli build -p android --profile preview
```
Set the `preview` profile's `EXPO_PUBLIC_API_URL` in `mobile/eas.json` to the backend tunnel URL first. (Requires a free Expo account; the build runs in Expo's cloud and returns a download link.)
