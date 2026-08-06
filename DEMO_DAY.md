# Demo Day Runbook

Everything is prepared. Clean demo data is loaded, all three apps build, and the
full login → approvals → bulk-approve chain is verified working.

There are two ways to run the remote demo — pick one:

- **A) Screen-share (you drive, they watch)** — simplest & most reliable. Run locally, share your screen. No tunnels, no DNS issues.
- **B) Hands-on (seniors open it on their own devices / try the mobile app)** — use the tunnels.

---

## The morning of the demo

### 1. Reset to clean demo data (30 sec)
```powershell
cd D:\Signage\backend
npm run demo:reset
```
This loads a full dataset: **5 vendors, ~20 employees, ~27 stores, and ~46 tasks** spanning every type and status — 30 pending (12 unassigned for the assignment demo), 6 completed, **5 recees waiting in the Approvals queue**, and 5 auto-generated post-recee installs. Alice (mobile) has 4 assigned tasks. Vendors/stores/employees persist across re-runs; tasks are regenerated each time.

### 2A. If SCREEN-SHARE demo — start locally
```powershell
# window 1
cd D:\Signage\backend ; npm run dev
# window 2
cd D:\Signage\web ; npm run dev
```
- Web console: **http://localhost:5173** (open in your browser, share that screen)
- For the mobile part: `cd D:\Signage\mobile ; npx expo start` → open on the Android emulator or scan with Expo Go on your own phone, and show that on screen.

### 2B. If HANDS-ON demo — start tunnels
```powershell
cd D:\Signage
powershell -ExecutionPolicy Bypass -File scripts\start-public-test.ps1
```
It prints a **Web console URL** — send that to your seniors. For mobile:
```powershell
cd D:\Signage\mobile ; npx expo start --tunnel
```
Seniors install **Expo Go** and scan the QR.
> To open the tunneled web URL on *your own* laptop too, set your Wi-Fi DNS to `1.1.1.1`, or just present from **localhost:5173** (same app) while they use the tunnel URL.

---

## Logins
| Role | Email | Password |
|---|---|---|
| RJCorp Admin (superuser) | `rjadmin@test.com` | `password123` |
| Vendor Admin (Acme, VND-001) | `bob@test.com` | `password123` |
| Employee (mobile) | `alice@test.com` | `password123` |

---

## Suggested demo script (~8–10 min)

1. **Login as RJCorp admin** → land on **Tasks**. Show the All / Recee / Boarding / Direct sub-tabs and the status badges (Assigned / Unassigned / etc.).
2. **Approvals (the headline feature)** → the queue shows 3 recees awaiting approval.
   - Show the **filters**: search "alpha" or by store/vendor UID, filter by vendor, oldest-first sort.
   - **Select all → Approve selected** → pick brand **BrandX** + artwork **BrandX-Festive-2026** → Confirm → "3 approved". Point out 3 post-recee install tasks were auto-generated.
   - (Optional) show **Reject selected** with a reason, and **Review ›** for per-signage accept/reject.
3. **Onboarding → Account** → show role dropdown includes any **custom roles**; show that creating a user can email credentials (if SMTP configured).
4. **Bulk Upload** → show the tabbed importer (Vendors/Stores/Users/Tasks) — mention the reference PDF `docs/Signage_Bulk_Upload_Reference.pdf`.
5. **Manage → Artworks / Roles / Vendors / Employees** → show artwork catalog + active toggles + custom-role builder.
6. **Mobile (employee)**: login as Alice → open a **Installation w/o Recee** task → show the per-signage plan with **recee photo + artwork image + details** before the camera; show GPS/annotation.
7. Wrap: mention it's the same backend for web + mobile, RBAC, and it's cloud-DB backed (Supabase).

---

## Stop after the demo
```powershell
# if you used tunnels:
cd D:\Signage ; powershell -ExecutionPolicy Bypass -File scripts\stop-public-test.ps1
```
Then close the backend / web / expo windows.

---

## Gotchas / quick fixes
- **Keep the laptop awake & plugged in** (disable sleep) for the whole session.
- **Tunnel URLs change every restart** — always share the freshly printed one.
- **"Approvals" empty?** Re-run `npm run demo:reset`.
- **Port already in use** when starting? Close old server windows first, or run the stop script.
- **Credential emails**: only send if you filled real Gmail SMTP in `backend/.env` (`SMTP_USER` + 16-char App Password). Optional — the rest of the demo works without it.
- **Login fails / network error on mobile**: the mobile `.env` `EXPO_PUBLIC_API_URL` must point at a reachable backend (localhost won't work from a phone — use the tunnel URL or your LAN IP).
