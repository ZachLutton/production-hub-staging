# ZedOps inventory — testing guide for Zach

This is the staging inventory page only (`inventory.html` on branch `cursor/feat-plate-split-56a8`). It is not deployed. It does not read or write the live Production Hub.

The live project id is `zedrics-production-hub`. Do not paste that project into `firebase-config.js`. The page refuses to start and shows an error. It does not open a database. A test fails if that id shows up in the inventory code.

## What changed

- Stores are a list you edit. The list starts with the two stores you have now. You can add store 3 and a commissary. Nothing in the page assumes those two names.
- Each store has an id, a name, pickup (yes/no), a delivery-hub flag, a production-kitchen flag, door shelves with full and half capacities, and a backstock cooler.
- Split percents are per store and must add up to 100. Deliveries go to whichever store is marked the delivery hub.
- Transfers can run between any two locations, including a commissary case or cooler. Counts are stored under the store id.
- A shelf holds 72 plates, or 36 per dish when two dishes share it. The first store's door 6 starts at 48 full / 24 half because a rack blocks that door. The case suggestion never goes above that shelf. The rest is backstock. Every store in the split still gets the dish when there are plates left after pickups and deliveries.
- Stack height is 6 for every dish, including half-pound. Change that one number when the deeper containers arrive.
- A Shopify product CSV maps SKUs to dishes. The SKU is the UPC on the label. A hand-entered link is only for a code the list does not know.
- Until you paste a new Firebase project, counts stay in this browser.

## Open it

1. Open `inventory.html` from this branch (this branch's staging site, or a local file). It is not the live Production Hub.
2. Enter the team PIN. Firebase Auth checks it through the shared hub login. The page does not compare a PIN itself, and it does not open counts until that sign-in succeeds. For an admin session, tap **Admin login** under the box first.
3. With the committed ZedOps Staging config, the banner names that project. The live hub is not connected. Monthly inventory counts stay on `staging_inventory`. This page uses the `staging_inv_*` paths only.

The first open loads sample counts so you can click through. Those numbers are not this week's plate list. **Download backup** before you replace them. **Import backup** moves a file to another tablet. **Reset sample data** puts the sample back, and only in this browser.

## Create the staging Firebase project

Do this when you want two tablets to share the staging counts. Until then, skip it. The page keeps working in the browser.

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in with the Google account that should own the staging project.
2. Click **Add project**. Name it something like ZedOps Staging. Turn off Google Analytics if it asks. You do not need it.
3. Do not open the existing Production Hub project. If the project id or database URL contains that live id, this page shows an error and does not start.
4. In the new project, open **Build → Realtime Database → Create Database**. Pick a US region. Start in **locked mode**.
5. Open the **Rules** tab and publish `database.rules.staging.json` from this branch. Those rules deny the root and allow each `staging_*` path only for the two hub Auth accounts. Do not paste open read/write rules. Do not publish them with `firebase deploy` from this repo: `.firebaserc` points at the live project. Enable Email/Password and create the two users described in `docs/staging-checklist.md` before expecting the page to load counts.

These rules are for the ZedOps Staging project only. They are not the live hub's rules.

6. Click the gear, then **Project settings → Your apps → Web** (`</>`). Register the app as "ZedOps inventory". Skip Hosting. Copy the config it shows.
7. On this branch, open `firebase-config.js`. Paste `apiKey`, `authDomain`, `databaseURL`, `projectId`, `storageBucket`, `messagingSenderId`, and `appId` inside the quotes. Leave `projectId` empty if you are not ready. Do not commit the live project's config.
8. Reload `inventory.html`. The banner should name the staging project. If it says this browser, the config is empty or the scripts could not load. If the config is the live project, the page shows a full-screen error and does not start. The full staging rules file is `database.rules.staging.json`. See `docs/staging-checklist.md`.
9. Counts already in the browser do not move themselves. Download a backup first, then **Import backup** after the banner shows the staging project, if you want those counts there.

## Case value, Thursday through Wednesday

**Case value** is in the section bar.

1. Log a transfer into a store case, or apply a split. Meals that only go to a backstock cooler stay off this screen.
2. Open **Case value**. The week is Thursday through Wednesday.
3. Enter the tray, film, and gas cost for one meal. Enter the product cost (the food) on that dish’s row.
4. **Save costs**. The case total is meals times tray, film, gas, and product. Labor is not in the total.
5. **Previous week** shows the Thursday-to-Wednesday week before this one.

A dish with no product cost stays blank. It is not treated as $0.

## 1. Stores, including a third store and a commissary

**Stores** is in the section bar.

1. You should see the two current stores: Colonnade at 60% (door 6 is 48 full / 24 half, because of the rack) and Rim at 40% (this one starts as the delivery hub). Other doors are 72 full / 36 half. Those names come from the store list, not from fixed buttons.
2. Type `Store 3` and click **Add store**. Set the three percents to 50, 30, and 20. They must add up to 100. **Save stores**.
3. Open **Log Transfer**. From and To should list the new store's case and its backstock cooler, plus the original locations.
4. Type `Commissary` and click **Add commissary**. It is a production kitchen, share 0, with a cooler. It is not in the split until you give it a percent. **Save stores**. The 50/30/20 total should still be 100.
5. **Log Transfer** should now include the commissary case and cooler. Pick the new store's case as From and the commissary cooler as To. That path is the same as a transfer between the original two stores.

## 2. Transfer, oldest first

Sample data at the first store's case has an earlier use-by and a later one for Tex Mex Turkey Picadillo.

1. **Log Transfer**. From: the first store's case. To: the second store's case.
2. Scan barcode `012345678905` (or type it in Scan and press Enter). That code is linked to Tex Mex Turkey Picadillo. One scan adds 1. Type `6` in Qty, then scan again, and it adds 6.
3. The "Oldest first" box should take the earlier use-by before the later one.
4. **Log Transfer**. Dashboard counts for that dish should drop at the first store and rise at the second, by use-by date. **Log History** should show the transfer.

A short count asks you to confirm and logs "Short N units". It does not invent meals.

## 3. Scanner and Shopify SKUs

The scan bar is on **Log Transfer**, **Receive**, **Backstock**, and **Physical Count**. A USB or Bluetooth scanner that types the code and then Enter uses that bar. If the cursor is in a quantity or search box, the scanner will not steal those keystrokes.

- Same code again adds 1.
- Type a quantity, then scan, to add that many. The quantity goes back to 1.
- On **Receive**, click **Import Shopify SKU CSV**. Use a product export that has `Title` and `Variant SKU`. The SKU should be the UPC printed on the label. After import, scanning that UPC files the dish without a hand link.
- A code that is not in the SKU list opens **Link this barcode**. Pick the dish once. The next scan adds that dish.
- **Receive**: choose where it lands and the plate date. Use-by is plate date plus that dish's shelf life. Save receipt adds to the count.
- **Physical Count**: a scan adds 1 to that dish's counted number (it does not replace what you typed).

## 4. Backstock cooler

**Backstock** is its own location on each store that has a cooler, separate from the case.

1. Pick the cooler. A new store and a commissary show up here after you save them.
2. Scan the meals in it. Save.
3. Only scanned dishes change. Turn on "Set unscanned dishes in this cooler to 0" only when you have scanned the whole cooler.
4. If a case is empty and that store's cooler has meals, the dashboard suggests a pull, up to what the shelf can hold. **Review** opens a transfer. Nothing moves until you log it.

## 5. Split

**Split** is a suggestion. It does not move anything until you press **Apply split** and confirm.

- Each store in the split has a percent. The total has to be 100 before you can save or apply. A production kitchen with no percent is left out.
- Pickup fields stay at that store.
- Delivery is assigned to the delivery hub, not to a fixed store name.
- The rest is split by those percents and rounded to the stack height. The height is one number, default 6, for every dish.
- The case line stops at that store's shelf for the dish's door. Anything above that is backstock. A full shelf is 72 (48 on the blocked door). A shared shelf is 36 per dish (24 on the blocked door).
- Both of the original stores, and any other store you included in the split, get the dish when enough plates are left. A prepaid order is not taken from the store the customer chose to feed another store.
- The stores add up to the plated count.
- **Load practice week** fills sample plated numbers, including Orange Chicken. Beef Taco Skillet stays on the skip list and is not split. A large dish should show a case qty at the cap and a backstock remainder. A half-pound dish should show the lower cap on door 6 at the first store.
- Import a CSV (`dish,plated` or `dish,store,qty,type` with type `pickup` or `delivery`) or a plate-list JSON file you already have. The page will not fetch the hub. Store names in the CSV have to match the store name or id in **Stores**.
- Apply downloads a backup file first, then sets the case and backstock count for that use-by date (plate date + shelf life) at each store in the split. Older use-by dates stay.
- **Propose share changes** looks at the last 7 days of stockouts and orange-star logs. Approve saves a new share for that dish. The percents still add up to 100. It does not move food.

## 6. Orange star and the skip list

**Log Adjustment → Orange star** records the count and does not remove inventory. The dashboard can use that, with a case at 0 at another store, to suggest a move.

Skip list defaults to **Beef Taco Skillet** only. Orange Chicken is back in stock and is on the entree list. Edit the skip list on the Split screen and save it.

## 7. Phone or tablet

The section bar scrolls sideways. Scan, quantity, store percents, and the split inputs use a large type size. Check Transfer, Stores, Backstock, and Split in portrait.

## What this does not do

- It does not read or write the live Production Hub project.
- It does not deploy.
- It does not call Shopify. The SKU file is a CSV you export and import.
- Two tablets do not share counts until `firebase-config.js` points at the new staging project.
