# Weight check — how to try it

This is on the staging Production Hub (`index.html` on this branch). The production page matches the live hub as of commit `5146318` (13 Oct 2026, “Schedule the Rim reminder for 09:00 UTC on Tuesdays”), with these staging differences: the yellow STAGING banner, saves go to `staging_productionData`, `staging_dishLibrary`, and `staging_history`, and the page reads Firebase only from `firebase-config.js`. It will not start if that file names the live project.

Weight checks are a new staging feature on that page. They are not on the live hub. They are not saved in the live Firebase project. With an empty `firebase-config.js` they stay in this browser (`staging_weight` is used only after the ZedOps Staging project is pasted in).

The public staging site is this branch: https://zachlutton.github.io/production-hub-staging/ . Open that, or open `index.html` from this branch on your computer. `main` and the live Production Hub are a different site and must not be used for this test.

## What you are checking

Each dish label has a serving size, such as Blackened Chicken Alfredo: **Serving size (340g)**. That number is the target weight. The pass range starts at **20 grams either side** (320–360g). You can change the 20 for one dish.

Plating stays on paper. Nobody needs a tablet on the line.

- **Check 1** is the 8th plate on the first tray.
- **Check 2** is a plate from a middle tray.
- If a plate is outside the range: fix the portion, recheck the next plate, and circle it.

## 1. Set the target

1. Open `index.html` from this branch and sign in the way you already do.
2. Click **Weight check**.
3. Open **Targets**.
4. Find **Blackened Chicken Alfredo Penne (3)**.
5. In the target box, type `340` or paste `Serving size (340g)`.
6. Leave the tolerance at `20`, or type a different number if this dish needs a tighter range.
7. Click **Save targets**. You should see a note that it was saved on staging.

The live hub’s production list is not changed by this save.

## 2. Print the sheet

1. Stay in **Weight check** and open **Print sheet**.
2. Choose the production day.
3. Click **Print weight check sheet**.
4. The page should list the dishes in that day’s plating order (Station 1, then Station 2, and so on). Dishes still sitting in the Queue are left off once any station has dishes.
5. Each dish shows the target grams and the pass range. Alfredo should show **340g** and **320–360g**.
6. Each dish has two blank checks: weight, plater initials, and checker initials.
7. The top of the sheet says: **Out of range: fix the portion, recheck the next plate, circle it.**

Hand that page to the line. They write on it. They do not enter numbers in the hub during plating.

## 3. Enter the sheet at the end of the day

1. Click **Weight check**, then **Enter weights**.
2. Choose the day and **Blackened Chicken Alfredo Penne (3)**.
3. Check **1**. Weight `350`. Plater initials and checker initials, for example `AL` and `HK`. Leave recheck blank. Save.
4. The hub should say **350g is a pass** (320–360g).
5. Enter check **2** with weight `300`, the same initials, and a recheck of `345`. Save.
6. The hub should say **300g is a miss**, and the recheck **345g is a pass**.

## 4. Read it on the end-of-day report

1. In **Weight check**, open **Report**. The 300g row is highlighted as a miss. The summary counts that miss under the plater’s initials and under the dish.
2. Open **History**, then open a saved week (or look at the weight report for today). The same checks are listed under **Weight checks**, with misses highlighted, plus misses by plater and by dish for everything saved so far.

A pass stays unhighlighted. A miss stays highlighted even if the recheck passed, so you can see that the first plate was off.
