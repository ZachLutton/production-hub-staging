# Staging checklist

The staging site is this branch, served at https://zachlutton.github.io/production-hub-staging/ .

It must use only its own Firebase project, named **ZedOps Staging**. It must never read or write the live project `zedrics-production-hub`. `main` and the live deployment stay as they are.

## One config

Every page (`index.html`, `dashboard.html`, `weekly-order.html`, `monthly-inventory.html`, `inventory.html`, and the weight-check code those pages load) reads Firebase from `firebase-config.js` only.

- That file is a placeholder. Leave the values empty until the owner pastes the ZedOps Staging web config (`apiKey`, `authDomain`, `databaseURL`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`).
- Empty config: the page keeps working in this browser and shows a yellow **BROWSER ONLY** banner. Nothing is sent to Firebase.
- If `projectId`, `databaseURL`, `authDomain`, or `storageBucket` contains `zedrics-production-hub`, the page refuses to start and shows a full-screen error. It does not call `initializeApp`.
- A new feature must not hardcode a project id, database URL, or API key in a page. Add the new database path to `database.rules.staging.json` and to this list.

`firebase.json` still points at the live rules file `database.rules.json`. Do not change that in order to publish staging rules. Do not run `firebase deploy` against `zedrics-production-hub` from this branch.

## Rules

`database.rules.staging.json` is for the ZedOps Staging project only. It is not deployed by this change. Publish it in that project's Realtime Database rules tab, or with the Firebase CLI pointed at the new project and this file. Never publish it to the live project.

The file denies the root and opens read and write on each path the pages use:

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

Open read and write is temporary so tablets can share data before Auth users exist. Anyone who can reach the database URL can read and write these paths.

Tighter option, after the two Auth users below exist in the ZedOps Staging project: set each path's `.read` and `.write` to the same expression the live rules use, with those two emails. Anonymous and unsigned requests would then be denied. Do not copy the live rules file onto this project as-is without checking the paths above, and do not deploy that tighter file to `zedrics-production-hub`.

```
auth != null
&& auth.token.firebase.sign_in_provider === 'password'
&& (auth.token.email === 'team@zedrics-production-hub.firebaseapp.com'
    || auth.token.email === 'admin@zedrics-production-hub.firebaseapp.com')
```

## Auth

Yes. The staging project needs Authentication set up before PIN login works against it.

These pages sign in with Firebase Auth email/password through `hub-auth.js`:

- `index.html` (production board and weight checks)
- `dashboard.html`
- `weekly-order.html`
- `monthly-inventory.html`

`inventory.html` does not use Firebase Auth. Its PIN is checked in the browser only.

The accounts are not stored as passwords in the repo. `hub-auth.js` signs in as:

- `team@zedrics-production-hub.firebaseapp.com` (team PIN, password `zph-team-` plus the PIN)
- `admin@zedrics-production-hub.firebaseapp.com` (admin PIN, password `zph-admin-` plus the PIN)

Enable this on the ZedOps Staging project:

1. Build → Authentication → Sign-in method → Email/Password → Enable.
2. Authentication → Users → Add user, twice, with those exact email addresses. Set each password in the console to `zph-team-` or `zph-admin-` plus the PIN. The email domain does not have to match the new project's auth domain. Firebase stores the email as the user id.
3. Build → Realtime Database → Create database. Publish `database.rules.staging.json`.

Until `firebase-config.js` is filled in, those pages do not call Auth. A PIN on the login screen is only a local session, and the banner says so. After the config is pasted, PIN login calls the ZedOps Staging project, not the live one.

Weight checks do not have a separate login. They open after the production page login. Their saves use `staging_weight` on the same project, or this browser when the config is empty.
