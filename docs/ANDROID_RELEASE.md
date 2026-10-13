# Android release — process and status

Status: **preview APKs only.** Nothing has been submitted to Google Play, and no approval is claimed.

## Before a production build
1. `cd backend && npm test && npx tsc --noEmit`; `cd web && npm run typecheck && npm run build`;
   `cd mobile && npx tsc --noEmit`.
2. Run migrations (`cd backend && npm run migrate`) — additive, safe before deploying the new backend.
3. Confirm `mobile/eas.json` production profile points at the production API (no localhost).
4. Test on a real Android device: GPS permission, camera permission, photo upload, drafts after
   force-close, airplane-mode submit and retry, each task workflow, each role.

## Build and submit
- `eas build --profile production --platform android` (produces an .aab).
- Play Console → create app → upload the .aab to **Internal testing**, then Closed testing, then Production.
- A native change (new permission/plugin/SDK) needs a new build; JS-only changes ship with `eas update`.

## Play Console items still to prepare
- Store listing: name, short + full description, icon, feature graphic, phone screenshots.
- Privacy policy URL (the app collects location, camera photos, name/email/phone).
- Data safety form (location, photos, personal info; data encrypted in transit; account deletion path).
- Permissions declaration: location (foreground, used to prove presence at an outlet) and camera.
- Content rating questionnaire; target audience; app access (provide a test login for reviewers).
- Closed-testing requirement for new personal developer accounts (check the current Google policy).

iOS is a separate, later milestone.
