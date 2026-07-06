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

Per-cost-centre issue tracking (matching the old Excel sheet's Kitchen /
Guest Group breakdown) remains a deliberately deferred v3 — see "What's
next" below.

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

Staff sees: Purchases, Issues, Count, Orders.
Admin sees: all of the above, plus Items, Variance, and Dashboard.

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
