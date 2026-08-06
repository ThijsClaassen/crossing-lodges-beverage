# Crossing Lodges — Beverage Stock App (v2)

A standalone React + Vite app for beverage stock counts, purchases, issues,
and variance/costing — the first module of what's meant to become a set of
per-department apps (like `crossing-lodges-ops` for fleet/fuel) sharing one
Supabase project, so a company-wide dashboard can eventually query across all
of them.

v1 covered the "stock count & variance" priority: item master list, purchase
logging, a simple daily-total issues log, physical stock counts, a
weighted-average-cost variance engine, and an auto-generated reorder list.

v2 adds:
- **Admin / Staff login** (shared password per role, same pattern as the ops
  app), with Staff limited to Purchases, Issues, Count, and Orders, and Admin
  getting everything plus a Dashboard.
- **Pricing tier per item** — `Included` (all-inclusive) or `Premium` — so
  stock and consumption value can be split by tier.
- **Dashboard (Admin only)**: total stock value (both the theoretical
  running estimate and the actual counted value, plus the Rand-value gap
  between them), value of beverages used this month, all split by Included
  vs Premium, and lists of the fastest-moving and completely non-moving
  items this period to inform menu decisions.

Since v2, the app also picked up: barcode scanning on the Count tab (see
"Count tab: Scan mode" below), a Submit-and-clear workflow for counts (see
"Count tab: Submit & clear"), and now:

- **Suppliers** (Admin only, one list per lodge) — link each item to a
  supplier on the Items tab.
- **Write-off reasons on issues** — every issue is now logged as `Service`
  (normal guest consumption, the default) or a write-off reason: `Breakage`,
  `Expired`, `Staff`, `Other`.
- **Dashboard "By supplier"** — stock value, movement (Service qty/value),
  and write-offs (qty/value) rolled up per supplier, so you can see which
  supplier's products are moving, which are getting written off, and how
  much stock value sits with each one.
- **Orders grouped by supplier** — the reorder list is now broken into one
  section per supplier (with contact details shown if you've added them),
  so each supplier's order is ready to send as its own list. Items with no
  supplier linked land in an "Unassigned" group at the end. Each group has
  a **Copy list** button that copies just item name + order quantity (one
  per line, tab-separated) to the clipboard, ready to paste straight into
  an email, WhatsApp message, or spreadsheet to send to that supplier.
- **Order pack rounding** — you count stock in whatever unit makes sense
  (ml for spirits measured by the tot, "ea" for cans/bottles) but you don't
  always order in that same unit — a spirit is bought by the 750ml/1L
  bottle, a Coke by the six-pack. Each item now has an **order pack size**
  (how many count_units make up one orderable pack) and an optional
  **order pack label** (e.g. "750ml bottle", "6-pack") set on the Items
  tab. The Orders tab and its Copy list rounds the raw shortfall UP to
  whole packs, so a supplier order never asks for a fraction of a bottle
  or a partial six-pack. Leave pack size at 1 (the default) for any item
  you order in the same unit you count in — nothing changes for those.
- **Purchases tab: supplier as a dropdown** — the Supplier field when
  logging a purchase now picks from the same supplier list used elsewhere
  in the app (Items, Suppliers, Orders tabs), instead of a free-text box.
  Keeps supplier names spelled consistently everywhere they show up,
  instead of "Coca-Cola", "coca cola", "CocaCola" all being different
  strings. If you haven't added suppliers yet for a lodge, the dropdown
  will be empty — add them on the Suppliers tab first.
- **Dashboard write-off total** — a single, at-a-glance number for total
  units written off this period (breakage, expired, staff, other — see
  "By supplier" for a per-supplier breakdown, or the Issues tab for the
  full per-entry log).

Per-cost-centre issue tracking (matching the old Excel sheet's Kitchen /
Guest Group breakdown) remains a deliberately deferred feature — see
"What's next" below.

## 1. Database setup

This app is designed to live in the **same Supabase project** as
`crossing-lodges-ops` (`https://arrendpmuwdhrfwvokhv.supabase.co`), using
department-prefixed tables (`bev_...`) as recommended in that app's own
technical notes. It does not have to be — it'll work against any Supabase
project — but sharing one project is what makes a future combined dashboard
easy (single database, no API integration layer needed).

**Already ran `schema.sql` and `seed_items.sql` before (v1)?** Just run
`supabase/migration_v2.sql` once — it's safe to run on the live database and
adds the `pricing_tier` column and the `bev_access` login table without
touching your existing data.

**Already on v2 (have `bev_access`)?** Just run `supabase/migration_v3.sql`
— adds the `barcode` column used by Scan mode. Also safe to run on the live
database.

**Already on v3 (have `barcode`)?** Just run `supabase/migration_v4.sql` —
adds the `bev_suppliers` table, links items to suppliers, and adds the
`reason` column on issues. Also safe to run on the live database.

**Already on v4 (have `bev_suppliers`)?** Just run
`supabase/migration_v5.sql` — adds `order_pack_size` (default 1, so nothing
changes until you set it) and `order_pack_label` to `bev_items`. Also safe
to run on the live database.

**Fresh install:**

1. Open the Supabase SQL editor for the project you're using.
2. Run `supabase/schema.sql` — creates `bev_items`, `bev_stock_periods`,
   `bev_purchases`, `bev_issues`, `bev_access`, with the same open
   `allow_all` RLS policy style the ops app currently uses (anon key, no
   per-user login — see "Admin/Staff login" below for how role-gating
   actually works here).
3. Run `supabase/seed_items.sql` — loads the ~109 beverage items from your
   existing Excel template's Cost Centre List tab into **all three lodges**
   (ZC, EC, SC) as an identical starting point, since the item list is fully
   separate per lodge in this design. Edit names, categories, or min/max
   levels per lodge afterwards in the Items tab — changes to one lodge won't
   touch the others.

## Admin / Staff login

`bev_access` holds one row per role with a plain password — same
shared-password simplicity as the ops app's `app_access` table, just a
separate table (so passwords aren't shared between the two apps). Default
passwords after running the SQL are:

- Admin: `ChangeMe-Admin1`
- Staff: `ChangeMe-Staff1`

**Change both immediately** in Supabase → Table Editor → `bev_access` →
edit the `password` cell for each row. There's no in-app password-change
screen on purpose — managing it in the Table Editor is one less thing this
app needs to secure.

Important honest caveat: like the ops app, this is a **client-side gate**,
not real per-user database security. Both roles authenticate to Supabase
with the exact same anon key — the Staff/Admin split only controls which
tabs the app *shows*, not what the database *allows*. Anyone with the anon
key and a browser console could technically still write to any table. If
that ever matters (e.g. real audit trails, stricter data protection), the
fix is moving to Supabase Auth with individual logins — a bigger change,
flagged here so it's a deliberate choice, not a surprise.

Staff sees: Issues, Count. On Count, Staff only sees the Item and Counted
columns — Theoretical and Variance are hidden so a count isn't unconsciously
anchored to what the books say should be there.
Admin sees everything: Dashboard, Items, Suppliers, Opening, Purchases,
Issues, Count (with Theoretical/Variance visible), Variance, and Orders.

## Correcting opening stock / cost

There's no editable "cost" field on an item itself — cost is always derived
from opening cost per unit + logged purchases (weighted average). The
**Opening** tab (Admin only) is where you set or correct opening units and
opening cost per unit for the current period — needed especially for your
very first month, where "Start period" has nothing to carry forward from and
defaults everything to 0. Run "Start {period}" first (see the banner), then
each item becomes editable in the Opening tab.

## 2. Connect the app to your project

`src/sb.js` already has the `arrendpmuwdhrfwvokhv` project's URL and anon
(publishable) key baked in as the default, matching how the ops app bakes
credentials into `App.jsx`. If you ever need to point this at a different
project, either edit those two constants directly, **or** create a `.env`
file in this folder (it overrides the baked-in defaults):

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Get both values from Supabase → Project Settings → API.

## 3. Run locally

```
npm install
npm run dev
```

## 4. Deploy

Push this folder to a new GitHub repo (e.g.
`crossing-lodges-beverage`), then import it into Vercel — same flow as the
ops app (auto-deploys on push to `main`). No environment variables are
required if you baked the credentials into `sb.js`; otherwise add
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel project env vars.

The app is a PWA (`public/manifest.webmanifest` is included) — add real
icons to `/public` the same way the ops app does if you want a proper
"Add to Home Screen" icon; it'll work without them, just with a default one.

## Purchases tab: Scan a slip (AI-read purchases)

Instead of typing each line of a delivery slip or invoice by hand, the
Purchases tab now has a **Scan / photograph slip** button. Take a photo (or
upload one) and the app reads the item list, quantities, and prices off it
automatically, using Anthropic's Claude API (a vision-capable AI model) —
then shows you a review screen before anything is saved. Nothing is written
to the database until a person presses **Approve & save**; the AI only ever
proposes a draft.

On the review screen, each line from the slip gets matched against your
existing item list:

- **Green "Matched"** — the app is confident this line corresponds to a
  specific item; it's pre-selected in the dropdown. Still worth a glance,
  but usually just needs the qty/cost double-checked.
- **Amber "Check this"** — no confident match. The dropdown starts empty
  (with the AI's best guess shown as a hint in the placeholder text, if it
  has one) — pick the right item, or tick **Skip** to leave that line out
  entirely. Nothing gets added to stock without a person confirming it.

Date and supplier are also read off the slip where visible and pre-filled
(supplier as a dropdown from your supplier list, same as manual entry —
see above); both are editable before you approve. Approving inserts one
row per non-skipped, matched line into the exact same `bev_purchases` table
manual entries use — there's no separate "scanned purchases" table, and
none of the costing formulas changed.

### Setup (required before this works)

This feature needs an Anthropic API key — it's a separate thing from your
Claude.ai login, meant for developers/apps to call Claude programmatically,
and it costs a small amount per use (a photo like this is typically a
fraction of a cent to a few cents, depending on the model).

1. Go to **console.anthropic.com**, create an account (or use an existing
   one), and set up billing.
2. Create an API key there.
3. In **Vercel → this project → Settings → Environment Variables**, add:
   - `ANTHROPIC_API_KEY` = the key you just created
   - (optional) `ANTHROPIC_MODEL` = a specific model name, if you ever want
     to change it from the default (`claude-sonnet-5`) — check
     `docs.claude.com` for current model names if this stops working after
     a long time, since model names do get retired eventually.
4. Redeploy (Vercel → Deployments → Redeploy) so the new environment
   variable takes effect.

**Never put the API key in the code or in a `.env` file that gets
committed** — it's a real secret, unlike the Supabase anon key. Vercel's
Environment Variables panel keeps it out of the repo and out of the
browser; the key is only ever used inside `api/parse-slip.js`, which runs
on Vercel's servers, not in anyone's browser.

**Local testing:** this feature calls `/api/parse-slip`, which only exists
once deployed to Vercel — plain `npm run dev` won't have it (Vite's dev
server doesn't know about `/api` routes). Test it after deploying, or run
`vercel dev` locally if you want to test before pushing to production.

## Count tab: Scan mode

Click **Scan barcode** to open the camera and read standard 1D barcodes
(UPC/EAN — the kind printed on bottles and cans). Scanning a barcode
that's already linked to an item jumps straight to that item's count field,
highlighted, ready to type. Scanning an unrecognized barcode shows a small
"link it to an item" prompt — pick the matching item once, and every future
scan of that same bottle recognizes it instantly (no external barcode
database involved; this is your own data, so it's free and works offline
once linked). After typing a count, press **Enter** to save that keystroke
and reopen the camera for the next scan.

Only items with real packaging (beers, ciders, soft drinks, spirits, most
wines) have a barcode to scan — poured items like tots, cocktails, and
glasses of wine don't, and stay in the regular manually-typed list.

Requires HTTPS (Vercel provides this) and a one-time camera permission
prompt in the browser. Uses `@zxing/browser` for the actual barcode
decoding — added to `package.json`, so `npm install` picks it up.

You don't have to scan to link a barcode — the **Items** tab (Admin) has a
Barcode column you can type into directly, if you'd rather enter numbers by
hand (e.g. from a spreadsheet) than physically scan every bottle.

A camera-loop race condition that crashed the app to a blank white screen
right after scanning has been fixed (the decoder is now stopped before the
scan overlay closes, instead of racing with it). An error boundary was also
added in `main.jsx` as a general safety net — if anything else ever throws
an uncaught error, you'll get a "Something went wrong / Reload" screen
instead of a silent blank page, which makes any future issue much easier to
report and debug.

## Count tab: Submit & clear

The Count tab no longer auto-saves field-by-field. Fields start empty every
time (the grey number in the box is just a reminder of the last saved
count, not a live value) — fill in what you're counting, hit **Submit
count**, and everything filled in saves in one batch while the sheet clears
itself, ready for the next round (e.g. next week's count). Anything left
blank when you submit is simply skipped and keeps its last saved value —
nothing gets overwritten with zero.

## Fast data entry

Saving a single field (a count, an opening value, an item edit) updates
that row directly in local state from what the server returned — it no
longer re-fetches everything and briefly blanks the screen behind a
"Loading…" placeholder. That full reload only happens when switching lodge
or period, or right after "Start period" / "Close period" (which touch
every item's row at once). This matches the "write back optimistically"
approach the ops app already uses.

## Responsive layout

Tables scroll horizontally within their own card on narrow screens instead
of breaking the page layout, the bottom nav scrolls sideways instead of
squeezing every tab into an unreadable sliver on phones, and the desktop
content area is wider to make better use of laptop screens.

## Branding

The app now uses the shared Crossing Lodges colour palette and fonts (Inter
for UI text, Cormorant Garamond for headings, Space Mono for numeric
values) — same tokens as the ops app.

**Logo:** drop your logo file into `public/logo.png` (exact filename
matters — the header, login screen, favicon, and PWA icon all reference
that path). Until that file exists, the app just quietly hides the broken
image rather than showing a broken-image icon, so nothing looks off in the
meantime.

## How the data model maps to the old Excel sheet

| Excel template | This app |
|---|---|
| Cost Centre List (beverage rows) | `bev_items` |
| Beverage Stock Sheet: opening stock columns | `bev_stock_periods.opening_units` / `opening_cost_per_unit` |
| Beverage Stock Sheet: 5 fixed "purchase" column groups | `bev_purchases` — one row per purchase, unlimited per item/period |
| Issues sheet: 10 fixed cost-centre column pairs | `bev_issues` — one row per issue; v1 is a simple daily total, not split by cost centre yet |
| Beverage Stock Sheet: closing count, variance, W/Avg cost columns | computed live in the app from the rows above (see `computeMetrics` in `src/App.jsx`) — nothing is stored redundantly |
| Beverage Orders tab | Orders tab, driven by the same min/max reorder logic |
| *(not in the old sheet)* | `bev_items.pricing_tier` + the Dashboard tab — Included vs Premium stock/consumption value split, requested to support all-inclusive vs premium-drinks decisions |

The weighted-average costing, theoretical-closing, and variance formulas are
carried over exactly as they worked in the sheet — just computed from real
rows instead of wide fixed-column formulas, and without the copy-paste
between monthly files (opening stock for a new period is carried forward
automatically via the "Start period" action).

## What's next (known limitations, by design)

- **Issues are a simple daily total per item**, not broken down by cost
  centre yet. Adding that later just means adding a `bev_cost_centres` table
  and a `cost_centre_id` column to `bev_issues` — no redesign needed.
- **No per-user login** — Admin/Staff is a shared password per role, gated
  client-side only (see "Admin / Staff login" above). Add Supabase Auth if
  you need a real audit trail of who logged what, or database-enforced
  role permissions instead of app-level ones.
- **RLS is fully open** (`allow_all`) via the anon key for the data tables,
  matching the ops app's current setup; `bev_access` is read-only from the
  client. Fine for an internal tool behind a shared password, but worth
  tightening if this ever becomes externally reachable.
- **Reorder logic uses theoretical closing stock** (opening + purchases -
  issues), the same basis the original sheet used — not the physical count —
  so it stays useful between stock takes.
- **"Value variance" on the Dashboard** only reflects items that have had a
  physical count in the current period — it's the Rand gap between the
  books and the actual count, so it's naturally smaller (or zero) early in
  a period before counts have been done.
- **Slip scanning is a best-effort read, not OCR-perfect** — blurry photos,
  handwriting, or unusual slip layouts can produce wrong quantities/prices
  or miss lines entirely. That's exactly why every scanned line goes
  through the review/approve screen instead of saving straight to the
  database — treat the AI's read as a fast first draft, not ground truth.
