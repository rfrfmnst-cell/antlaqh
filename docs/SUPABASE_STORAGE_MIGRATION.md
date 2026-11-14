# Antlaqh: Hostinger → Supabase private file storage

## Scope and verified state — 2026-11-11

- Source: `rfrfmnst-cell/antlaqh`, Node.js 24, production MySQL (`lib/store.js`), local private files (`DATA_DIR/files`).
- Supabase project: `nrthuyqonccejvasjedh` (انطلاقة), region `ap-southeast-1`. It was restored from inactive status to `ACTIVE_HEALTHY`.
- Created `storage.buckets.id = 'antlaqh-private'`: **private**, 10 MiB per object, PDF/PNG/JPEG/XLSX/CSV only.
- Existing WhatsApp Edge Functions are already deployed on Supabase; do not recreate them.
- An existing `antlaqh.records` table contained only **one row** at inspection time, not a verified backup of the Hostinger production MySQL records.
- The public website returned 403 to automated inspection, while `/api/health` and `/ready-websites/` returned 404. This does **not** verify whether the site works for regular visitors. Inspect Hostinger's Node.js deployment, domain routing, and WAF before a release.

## What this branch changes

The existing authentication, order checks, payment processing, and MySQL records are unchanged. `lib/file-storage.js` introduces optional **private** Supabase Storage for newly uploaded customer/order and digital-product files.

- Default `FILE_STORAGE_DRIVER=local`: existing Hostinger behavior.
- `FILE_STORAGE_DRIVER=supabase`: new files are written to `antlaqh-private` and their metadata receives `storage: "supabase"`.
- Records without that marker continue to read from their original `DATA_DIR/files` local path.
- Returning new writes to `local` while keeping the Supabase credentials **still allows reading existing remote files**.
- Failed uploads produce an error; there is no silent fallback to writing sensitive files in a different place.
- Remote storage remains accessible only from the trusted Node.js server via a server-only private key. Do not make the bucket public or add broad anonymous Storage RLS policies.

**Important performance boundary:** This implementation offloads **durable file storage** from Hostinger, not upload/download bandwidth or Node.js request handling. A separate authenticated short-lived signed-URL download flow, and later direct-to-Supabase uploads, would be needed to offload file-transfer bandwidth. Do not bypass the existing customer/order access checks.

## Before production activation

1. Download and verify independent encrypted backups of Hostinger's **MySQL** database and its persistent `DATA_DIR/files` (including a count of records and file IDs). Confirm the Hostinger `DATA_DIR` is persistent across redeployments. Do **not** delete the original files during this project.
2. Review PR and green CI, deploy the code with `FILE_STORAGE_DRIVER=local` first. Test `/api/health`, admin and customer logins, a payment-free test order, its old attachment, and a digital-product download before switching.
3. Add environment variables **only in Hostinger's private app environment**, never GitHub or public JavaScript:

   ```dotenv
   FILE_STORAGE_DRIVER=supabase
   SUPABASE_URL=https://nrthuyqonccejvasjedh.supabase.co
   SUPABASE_STORAGE_BUCKET=antlaqh-private
   SUPABASE_SERVICE_ROLE_KEY=<private server key from Supabase>
   ```

4. Confirm Hostinger's Node.js process can make outbound HTTPS requests to Supabase. Restart it and verify a small test upload, metadata marker `storage: "supabase"`, download as the rightful user, no access from another customer, and a download again after restart. Test a pre-migration local file too.
5. Check the Storage object and the application record before enabling for actual customers. Monitor storage errors and rate/quotas. Supabase is currently on the **Free plan**, where an inactive project may be paused; verify suitability for live production before relying on it.

## Recovery and deletion policy

- To stop new remote writes, set `FILE_STORAGE_DRIVER=local` **without removing the Supabase credentials**, so previously remote files remain readable. Do not revert the new file-storage code while any records contain `storage: "supabase"`.
- To migrate historical files, first copy all local objects to Supabase, compare byte count/checksum for every file, then atomically update the associated records' storage markers. Keep original Hostinger files until a separate validated cleanup.
- Database migration is a **separate operation**. Do not point the application at the nearly empty Supabase table or change the existing authentication model without a verified MySQL export, migration script, transaction/locking tests, and rollback procedure.
- Do not delete duplicate brand images until every reference (including marketing links/Open Graph and older cached pages) is verified. Assets in this repository are relatively small; moving images is less urgent than protecting customer attachments and database consistency.

## Security checklist

- Keep bucket `public=false`; do not place secrets in the repo, logs, or browser.
- RLS on `public` tables remains enabled. No anonymous access to private storage.
- Continue verifying the existing order/user permissions **before** serving files.
- Run `npm ci && npm test && npm run build` with Node.js 24 in CI.
- Verify Hostinger's routing and application startup separately; the public 404 responses do not prove which revision is currently deployed.
