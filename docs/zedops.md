# ZedOps foundation

The weekly BEK count is the first module on a shared ZedOps base. Later work (a new store, transfers, another vendor) should plug into these pieces instead of starting a new page with its own item list.

## For the owner

- A store is a name you can add. Any store can be marked the culinary center, the production hub, both, or neither. Colonnade is only the current setting, not a rule in the software.
- Every product lives in one catalog. The identity is the vendor plus the item number. BEK is first. Labelmatch, CPT, Airgas, and Michael Fleming use the same kind of record, and so can the next vendor.
- The shelf order is a separate list. Moving a row, or uploading Monday's guide, does not throw away counts. Counts stay on the item number.
- Two people can type at once, including at the same store. Each number is saved on its own. One person's lemon count does not replace someone else's oil count.
- The guide upload shows what moved, what is new, what was dropped, substitutions, and prices that went up or down. Nothing changes until you approve it.
- BEK prices go into the month-end count only on the last Monday of the month, and only after you approve them. Other months are left alone.
- Weekly ordering is one page. The production hub counts the full BEK catalog. Every other store counts that store's supplies (monthly items, without meals). Food amounts come from the scaled recipe PDF after you approve the raw totals. Cases always round up.
- The data has a version number. When the site is updated, it can bring older data forward without running that step twice.

## Before a deploy

Run this against ZedOps Staging, then encrypt the file the same way as the nightly Production Hub backup. Do not point it at the live project. Do not run `firebase deploy` from this branch (`.firebaserc` still names the live project).

```bash
node scripts/backup-staging.js --check
ZEDOPS_STAGING_DATABASE_URL='https://zedops-staging-default-rtdb.firebaseio.com' \
FIREBASE_SERVICE_ACCOUNT='...' \
node scripts/backup-staging.js
openssl cms -encrypt -binary -aes256 -stream -outform DER \
  -in backup-staging.json -out "zedops-staging-db-$(date -u +%Y-%m-%dT%H%M%SZ).json.cms" \
  scripts/backup-public-cert.pem
shred -u backup-staging.json
```

`scripts/backup-staging.js` writes the same kind of file as `scripts/backup-db.js` (time, database URL, counts, rules, data). It stops if the URL or the service account is the live Production Hub. The live nightly backup is unchanged and still runs only in the live repo.

GitHub can also run it by hand: Actions → **ZedOps Staging backup** → Run workflow. That workflow is limited to the staging repository.

## For the next module

| Piece | File | Use it for |
| --- | --- | --- |
| Sign-in | `hub-auth.js` | Team and admin PIN, already shared by every page |
| Firebase config | `firebase-config.js` and `staging-boot.js` | Staging project only. The live project is refused |
| Stores | `zedops/locations.js` | Add a store and set culinary center or production hub |
| Catalog | `zedops/catalog.js` | `vendor + item number`, shelf order kept separate |
| Saves | `zedops/storage.js` | One item, one par, one count. Not a whole list |
| Version | `zedops/schema.js` | `schemaVersion` in the data, migrations that can run twice |
| BEK count | `zedops/bek.js` | Guide diff, count units, Tuesday of the count, price gate |
| Recipes | `zedops/recipe-parse.js` | Raw purchase totals from a scaled-recipe layout. The browser PDF reader calls this same parser |
| Order math | `zedops/order-math.js` | Need minus on hand, rounded up to cases |

New database paths go in `database.rules.staging.json` with the same sign-in rule as the paths already there. Publish that file in the ZedOps Staging console. Do not publish it to the live project.

Paths added for this module:

- `staging_zedops_schema`
- `staging_zedops_locations`
- `staging_zedops_catalog`
- `staging_zedops_counts`
- `staging_zedops_pars`
- `staging_zedops_hidden`
- `staging_zedops_drafts`
- `staging_zedops_ingredient_map`
- `staging_zedops_recipe`
- `staging_zedops_price_approvals`
