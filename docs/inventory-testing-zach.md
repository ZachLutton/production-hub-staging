# ZedOps inventory — testing guide for Zach

This is the staging inventory page only (`inventory.html` on branch `cursor/feat-plate-split-56a8`). It does **not** talk to Firebase.

## Why it is local

`inventory.html` in this repo was pointed at the live Realtime Database, project `zedrics-production-hub` (`zedrics-production-hub-default-rtdb.firebaseio.com`). That is the same project as the live Production Hub. The old page also had a reference to the shared `dishLibrary` path. Writing “staging_” keys there would still be a write on the live project.

This branch removes the Firebase SDK from the inventory page. Counts, transfers, barcodes, the skip list, and split settings stay in this browser (`localStorage` key `zedops_staging_inv_local_v1`). The live hub, its rules, and `main` are unchanged. Nothing here is deployed.

The first time you open the page it loads **sample counts** so you can click through. Those numbers are not this week’s real plate list. Use **Download backup** before you replace them, and **Import backup** to move a file to another tablet. **Reset sample data** puts the sample back.

## Open it

1. Open `inventory.html` from this branch (a local file or a staging host that is not the live GitHub Pages site).
2. Enter the team PIN. It is checked only in the browser.
3. You should see an orange banner: local staging copy, not connected to Firebase.

## 1. Transfer, oldest first

Sample Picadillo at Colonnade case is 4 with an earlier use-by and 8 with a later one.

1. **Log Transfer**. From: Colonnade case. To: Rim case.
2. Scan barcode `012345678905` (or type it in Scan and press Enter). That code is already linked to Tex Mex Turkey Picadillo. One scan adds 1. Type `6` in Qty, then scan again, and it adds 6.
3. The “Oldest first” box should take the earlier use-by before the later one.
4. **Log Transfer**. Dashboard counts for that dish should drop at Colonnade and rise at the Rim, by use-by date. **Log History** should show the transfer.

A short count asks you to confirm and logs “Short N units”. It does not invent meals.

## 2. Scanner

The scan bar is on **Log Transfer**, **Receive**, **Backstock**, and **Physical Count**. A USB or Bluetooth scanner that types the code and then Enter uses that bar. If the cursor is in a quantity or search box, the scanner will not steal those keystrokes.

- Same code again adds 1.
- Type a quantity, then scan, to add that many. The quantity goes back to 1.
- An unknown code opens **Link this barcode**. Pick the dish once. The next scan adds that dish.
- **Receive**: choose where it lands and the plate date. Use-by is plate date plus that dish’s shelf life. Save receipt adds to the count.
- **Physical Count**: a scan adds 1 to that dish’s counted number (it does not replace what you typed).

## 3. Backstock cooler

**Backstock** is its own location at each store (Colonnade backstock and Rim backstock), separate from the case.

1. Pick the cooler.
2. Scan the meals in it. Save.
3. Only scanned dishes change. Turn on “Set unscanned dishes in this cooler to 0” only when you have scanned the whole cooler.
4. If a case is empty and that store’s cooler has meals, the dashboard suggests a pull. **Review** opens a transfer. Nothing moves until you log it.

## 4. Split

**Split** is a suggestion. It does not move anything until you press **Apply split** and confirm.

- Pickup Colonnade / Pickup Rim stay at that store.
- Delivery is assigned to the Rim.
- The rest is split by the share (default 60% Colonnade / 40% Rim). Change the percent and **Save settings**.
- Each store gets at least one stack when there are enough plates left after pickups and deliveries: 6 for a regular dish, 7 for a half-pound dish (name contains `1/2#`). Both are editable.
- The two stores add up to the plated count.
- **Load practice week** fills sample plated numbers, including Orange Chicken. Beef Taco Skillet stays on the skip list and is not split.
- Import a CSV (`dish,plated` or `dish,store,qty,type` with type `pickup` or `delivery`) or a plate-list JSON file you already have. The page will not fetch the hub.
- Apply downloads a backup file first, then sets the **case** count for that use-by date (plate date + shelf life) at each store. Older use-by dates stay.
- **Propose share changes** looks at the last 7 days of stockouts and orange-star logs in this browser. Approve saves a new share for that dish. It does not move food.

## 5. Orange star and the skip list

**Log Adjustment → Orange star** records the count and does not remove inventory. The dashboard can use that, with a case at 0 on the other side, to suggest a move.

Skip list defaults to **Beef Taco Skillet** only. Orange Chicken is back in stock and is on the entree list. Edit the skip list on the Split screen and save it.

## 6. Phone or tablet

The section bar scrolls sideways. Scan, quantity, and the split inputs use a large type size. Check Transfer, Backstock, and Split in portrait.

## What this does not do

- No live or staging Firebase reads or writes.
- No Shopify connection. Prepaid counts are typed or imported.
- Two tablets do not share counts unless you export and import the backup file.
