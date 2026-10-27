# Staging checklist

The staging site is this branch, served at https://zachlutton.github.io/production-hub-staging/ .

It must use only its own Firebase project, named **ZedOps Staging**. It must never read or write the live project `zedrics-production-hub`. `main` and the live deployment stay as they are.

## One config

Every page (`index.html`, `dashboard.html`, `weekly-order.html`, `monthly-inventory.html`, `inventory.html`, and the weight-check code those pages load) reads Firebase from `firebase-config.js` only.

- That file is the ZedOps Staging web config (`apiKey`, `authDomain`, `databaseURL`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`). Do not replace it with the live project.
- Empty config: the page keeps working in this browser and shows a yellow **BROWSER ONLY** banner. Nothing is sent to Firebase.
- If `projectId`, `databaseURL`, `authDomain`, or `storageBucket` contains `zedrics-production-hub`, the page refuses to start and shows a full-screen error. It does not call `initializeApp`.
- A new feature must not hardcode a project id, database URL, or API key in a page. Add the new database path to `database.rules.staging.json` and to this list.

`firebase.json` still points at the live rules file `database.rules.json`. Do not change that in order to publish staging rules. Do not run `firebase deploy` against `zedrics-production-hub` from this branch.

## Rules

`database.rules.staging.json` is for the ZedOps Staging project only. It is not deployed by this change. Publish it in that project's Realtime Database rules tab, or with the Firebase CLI pointed at the new project and this file. Never publish it to the live project.

The file denies the root. On each path the pages use, read and write are allowed only for the two Email/Password accounts listed under Auth:

| Path | Used by |
| --- | --- |
| `staging_productionData` | `index.html` production board |
| `staging_dishLibrary` | `index.html` dish guides |
| `staging_history` | `index.html` saved weeks |
| `staging_weight` | weight checks (`weight-check-store.js`) |
| `staging_inventory` | monthly counts and the item list the weekly order reads |
| `staging_weekly_orders` | `weekly-order.html` |
| `staging_inv_inventory` | ZedOps inventory counts |
| `staging_inv_adjustments` | ZedOps inventory adjustments |
| `staging_inv_counts` | ZedOps inventory count sheets |
| `staging_inv_caseConfig` | case layout |
| `staging_inv_transfers` | transfers |
| `staging_inv_stockouts` | stockouts |
| `staging_inv_shelfLife` | shelf life |
| `staging_inv_splitConfig` | store split |
| `staging_inv_barcodes` | barcode links |
| `staging_inv_skipList` | dishes left out of the split |
| `staging_inv_stores` | store list |
| `staging_inv_skuMap` | Shopify SKU map |
| `staging_inv_mealCosts` | tray, film, gas, and product cost per meal |

`.info/connected` is a Firebase connection flag, not a data path, so it is not in the rules file.

`database.rules.staging.json` denies the root. Each path above allows read and write only for a Firebase Email/Password sign-in as one of the two accounts below. Anonymous and signed-out requests are denied. Do not copy the live rules file onto this project. Do not deploy this file to `zedrics-production-hub`. Publishing it is a separate step in the ZedOps Staging console (or a CLI pointed at that project and this file). This repo's `firebase deploy` uses `.firebaserc`, which still names the live project, and `firebase.json`, which still names `database.rules.json`. Do not run it from this branch.

## Auth

Yes. The staging project needs Authentication set up before PIN login works against it.

These pages sign in with Firebase Auth email/password through `hub-auth.js` before they read or write a `staging_*` path:

- `index.html` (production board). Weight checks on that page use the same signed-in default app. They do not open a second Firebase app.
- `dashboard.html` (no database paths; the sign-in is shared with the other pages)
- `weekly-order.html`
- `monthly-inventory.html` (`staging_inventory` only)
- `inventory.html` (the `staging_inv_*` paths only). It does not check a PIN in the browser.

The accounts are not stored as passwords in the repo. `hub-auth.js` signs in as:

- `team@zedrics-production-hub.firebaseapp.com` (team PIN, password `zph-team-` plus the PIN)
- `admin@zedrics-production-hub.firebaseapp.com` (admin PIN, password `zph-admin-` plus the PIN)

The PIN box starts on Team. Tap **Admin login** under the box before entering the admin PIN. A wrong PIN does not open the data. The two inventory pages stay on different paths: monthly counts use `staging_inventory`, and ZedOps inventory uses `staging_inv_*`.

Enable this on the ZedOps Staging project:

1. Build → Authentication → Sign-in method → Email/Password → Enable.
2. Authentication → Users → Add user, twice, with those exact email addresses. Set each password in the console to `zph-team-` or `zph-admin-` plus the PIN. The email domain does not have to match the new project's auth domain. Firebase stores the email as the user id.
3. Build → Realtime Database → Create database. Publish `database.rules.staging.json`.

`firebase-config.js` on this branch names ZedOps Staging, so PIN login calls that project, not the live one. If every value in that file is cleared, the pages stay in this browser, show the yellow banner, and HubAuth keeps a local session without contacting Auth. With the committed config, a PIN is sent only to ZedOps Staging Auth.

Weight checks do not have a separate login. They open after the production page login and read `staging_weight` with that same signed-in app. A signed-out browser does not read or write that path. With an empty config they stay in this browser.
