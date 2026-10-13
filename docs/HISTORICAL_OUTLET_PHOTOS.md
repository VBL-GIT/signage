# Historical outlet photographs — what the business must supply

The application is ready to show a **reference photo per outlet** (stores.reference_image_url,
migration 033). It appears next to the outlet in the mobile search results. It is kept apart from the
photos employees take during activities, which are never overwritten.

**No import has been run and no legacy data has been assumed.** The legacy/EDI dataset has not been
delivered.

## Needed from the business
One file (CSV or Excel), one row per outlet:

| Column | Required | Notes |
|---|---|---|
| CUST_CD (Customer Code) | yes | Matching key. Must equal the store's Customer Code in the master. |
| IMAGE_URL **or** IMAGE_FILE | yes | A public HTTPS URL, or a file name inside an accompanying zip of images. |
| SPEED_ID | optional | Secondary key where Customer Code is missing. |

Rules to confirm: one image per outlet or several (the schema stores one); image format/size limits;
whether the legacy URLs stay reachable (if not, the images must be re-hosted in Supabase Storage).

## Not yet decided
Which activity types must require a shop-board/signage photo before submit. Every recee signage and
installation signage already requires a photo today; nothing new has been made mandatory.
