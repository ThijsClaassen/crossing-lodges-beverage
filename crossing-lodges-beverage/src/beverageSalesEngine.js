// Yoco live-sales -> bev_issues sync engine (2026-08-26, "Yoco Phase 2").
//
// Reads already-synced Yoco POS data (pos_sales_orders / pos_sales_line_items
// — kept fresh by the Finance Dashboard's yoco-sync Edge Function; this app
// never talks to the Yoco API directly and never holds a Yoco secret) for a
// date range, keeps the lines that classify as F&B income, resolves each to
// a bev_items row, and writes a 'Service' issue so stock comes down on its
// own when the bar rings something up.
//
// Direct port of curioSalesEngine.js — same classifier, same fuzzy
// matcher, same taught-alias mechanism, same upsert-keyed-on-line-item
// dedup. Kept as a local copy rather than a shared import because these are
// separate deploys with no shared package. Two differences from Curio:
//   - the income category filter is F&B, not the curio shop, and
//   - the issue reason is 'Service' (this app's existing "normal use"
//     reason, already excluded from write-off reporting) rather than
//     Curio's 'Sale'.
//
// Note on Food vs Beverage: Yoco classification only reaches "premium food
// and beverages" — it can't tell a beer from a burger. So this app filters
// to that category and then matches against ITS OWN item list; a burger
// simply won't match any bev_item and lands in the unmatched panel, where
// it belongs (the Food app will pick it up via its recipes). Nothing is
// ever guessed into the wrong item: below the confidence threshold a line
// stays unmatched until a person teaches it.
import { supabase } from './supabaseClient.js'
import { sb } from './sb.js'

// Same category id the Finance Dashboard's Budget vs Actual uses for F&B
// revenue (see posSalesEngine.js there).
const FNB_CATEGORY_ID = 'income_premium_food_and_beverages'

function normalizeForMatch(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function matchScore(a, b) {
  const na = normalizeForMatch(a)
  const nb = normalizeForMatch(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const tokensA = na.split(' ').filter(Boolean)
  const tokensB = nb.split(' ').filter(Boolean)
  const setB = new Set(tokensB)
  let overlap = 0
  for (const t of tokensA) if (setB.has(t)) overlap++
  const overlapScore = overlap / Math.max(tokensA.length, tokensB.length)
  const substrBonus = na.includes(nb) || nb.includes(na) ? 0.2 : 0
  return Math.min(1, overlapScore + substrBonus)
}

// Same confident-match threshold as this app's own slip-scan matcher —
// below this a line is always left unmatched rather than guessing wrong.
const MATCH_CONFIDENT = 0.55

function findBestMatch(text, candidates, nameKey = 'name') {
  let best = null
  let bestScore = 0
  for (const c of candidates) {
    const score = matchScore(text, c[nameKey])
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return { match: best, score: bestScore, confident: bestScore >= MATCH_CONFIDENT }
}

// Identical logic to classifyLineItem() in the Finance Dashboard's
// posSalesEngine.js — case-insensitive substring match, longest rule wins.
function classifyLineItem(name, mappings) {
  const lower = String(name || '').toLowerCase()
  let best = null
  for (const m of mappings || []) {
    const needle = String(m.match_text || '').toLowerCase().trim()
    if (!needle) continue
    if (lower.includes(needle)) {
      if (!best || needle.length > best.match_text.toLowerCase().length) best = m
    }
  }
  if (best) return { categoryId: best.category_id, matched: true }
  return { categoryId: null, matched: false }
}

async function fetchPosSalesLineItems({ companyId, locationId, start, end }) {
  let orderQuery = supabase
    .from('pos_sales_orders')
    .select('id, location_id, closed_at')
    .eq('company_id', companyId)
    .eq('status', 'completed')
    .gte('closed_at', `${start}T00:00:00`)
    .lte('closed_at', `${end}T23:59:59`)
  if (locationId) orderQuery = orderQuery.eq('location_id', locationId)

  const { data: orders, error: ordersErr } = await orderQuery
  if (ordersErr) throw ordersErr
  if (!orders || orders.length === 0) return []

  const orderById = new Map(orders.map((o) => [o.id, o]))
  const { data: lineItems, error: liErr } = await supabase
    .from('pos_sales_line_items')
    .select('id, order_id, name, quantity, net_amount, tax_amount')
    .in(
      'order_id',
      orders.map((o) => o.id)
    )
  if (liErr) throw liErr

  return (lineItems || []).map((li) => ({
    ...li,
    location_id: orderById.get(li.order_id)?.location_id ?? null,
    closed_at: orderById.get(li.order_id)?.closed_at ?? null,
  }))
}

async function fetchCategoryMap(companyId) {
  const { data, error } = await supabase
    .from('yoco_item_category_map')
    .select('match_text, category_id')
    .eq('company_id', companyId)
  if (error) throw error
  return data || []
}

async function fetchAliasMap(companyId) {
  const { data, error } = await supabase
    .from('bev_yoco_item_aliases')
    .select('yoco_item_name, item_id')
    .eq('company_id', companyId)
  if (error) throw error
  return new Map((data || []).map((row) => [row.yoco_item_name, row.item_id]))
}

// Teaches the sync a permanent (company_id, yoco_item_name) -> item_id
// match, called from the "Unmatched Yoco sales" panel. Re-running the sync
// afterwards picks it up immediately and creates the backlog of bev_issues
// for every previously-unmatched line with this name in the synced range.
export async function learnYocoItemMatch({ companyId, yocoItemName, itemId }) {
  const { error } = await supabase
    .from('bev_yoco_item_aliases')
    .upsert({ company_id: companyId, yoco_item_name: yocoItemName, item_id: itemId }, { onConflict: 'company_id,yoco_item_name' })
  if (error) throw error
}

// Runs the sync for [start, end] (YYYY-MM-DD, inclusive), optionally scoped
// to one location. `items` is the caller's already-loaded bev_items list.
//
// Returns { totalFnbLines, matched, created, updated, unmatched }.
export async function syncYocoSales({ companyId, locationId, start, end, items }) {
  const [lineItems, mappings, aliasMap] = await Promise.all([
    fetchPosSalesLineItems({ companyId, locationId, start, end }),
    fetchCategoryMap(companyId),
    fetchAliasMap(companyId),
  ])

  const fnbLines = lineItems.filter((li) => classifyLineItem(li.name, mappings).categoryId === FNB_CATEGORY_ID)

  const activeItems = (items || []).filter((it) => it.active !== false)
  const itemsById = new Map(activeItems.map((it) => [it.id, it]))

  const toUpsert = []
  const unmatchedByName = new Map()

  for (const li of fnbLines) {
    const aliasedItem = itemsById.get(aliasMap.get(li.name))
    const fuzzy = aliasedItem ? null : findBestMatch(li.name, activeItems, 'name')
    const resolved = aliasedItem || (fuzzy?.confident ? fuzzy.match : null)

    if (resolved) {
      const closedDate = (li.closed_at || '').slice(0, 10)
      toUpsert.push({
        company_id: companyId,
        item_id: resolved.id,
        location_id: li.location_id || resolved.location_id,
        period: closedDate.slice(0, 7),
        date: closedDate,
        qty: Number(li.quantity || 0),
        reason: 'Service',
        note: `Yoco sale — auto-synced ("${li.name}")`,
        yoco_line_item_id: li.id,
      })
    } else {
      const cur = unmatchedByName.get(li.name) || {
        name: li.name,
        orders: 0,
        quantity: 0,
        value: 0,
        lastSeen: null,
        suggestedItemId: fuzzy?.match?.id ?? null,
        suggestedItemName: fuzzy?.match?.name ?? null,
      }
      cur.orders += 1
      cur.quantity += Number(li.quantity || 0)
      cur.value += Number(li.net_amount || 0) - Number(li.tax_amount || 0)
      const seenDate = (li.closed_at || '').slice(0, 10)
      if (!cur.lastSeen || seenDate > cur.lastSeen) cur.lastSeen = seenDate
      unmatchedByName.set(li.name, cur)
    }
  }

  let created = 0
  let updated = 0
  if (toUpsert.length > 0) {
    const { data: existing } = await supabase
      .from('bev_issues')
      .select('yoco_line_item_id')
      .eq('company_id', companyId)
      .in(
        'yoco_line_item_id',
        toUpsert.map((r) => r.yoco_line_item_id)
      )
    const existingIds = new Set((existing || []).map((r) => r.yoco_line_item_id))
    created = toUpsert.filter((r) => !existingIds.has(r.yoco_line_item_id)).length
    updated = toUpsert.length - created

    await sb.upsert('bev_issues', toUpsert, 'company_id,yoco_line_item_id')
  }

  return {
    totalFnbLines: fnbLines.length,
    matched: toUpsert.length,
    created,
    updated,
    unmatched: Array.from(unmatchedByName.values()).sort((a, b) => b.value - a.value),
  }
}
