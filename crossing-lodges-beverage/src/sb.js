// Lightweight Supabase REST wrapper — deliberately not the Supabase JS SDK,
// matching the pattern used in crossing-lodges-ops (small bundle, no SDK
// version dependency, plain fetch calls against PostgREST).
//
// Fill in SUPABASE_URL / SUPABASE_ANON_KEY below with the SAME project used
// by the ops app (https://arrendpmuwdhrfwvokhv.supabase.co) so both apps
// share one database. You can either hard-code them here (as the ops app
// does) or supply them as Vite env vars (VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY) — either works, env vars are just easier to keep
// out of source control.

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js'

const REST = `${SUPABASE_URL}/rest/v1`

// Made async in the multi-tenant migration (Beverage Stock 3b, 2026-08-09) —
// every request now carries the logged-in user's session access token
// instead of just the anon key, which is what RLS's has_company_access()
// needs to identify the caller. Every call site below was updated to
// `await headers(...)` at the same time (see [[feedback-git-and-async-gotchas]]
// for why that matters — a missed await here is syntactically valid and
// parses clean, but silently sends no Authorization header at all).
async function headers(extra = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

function qs(filters = {}) {
  const parts = []
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue
    // pass through already-formed postgrest filters like { period: 'eq.2026-07' }
    parts.push(`${key}=${typeof value === 'string' && value.includes('.') ? value : `eq.${value}`}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

async function handle(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Supabase ${res.status}: ${text}`)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export const sb = {
  // select('bev_items', { location_id: 'ZC' }, { select: '*', order: 'name.asc' })
  async select(table, filters = {}, opts = {}) {
    const params = { ...filters }
    if (opts.select) params.select = opts.select
    if (opts.order) params.order = opts.order
    const res = await fetch(`${REST}/${table}${qs(params)}`, {
      headers: await headers(),
    })
    return handle(res)
  },

  async insert(table, rows) {
    const res = await fetch(`${REST}/${table}`, {
      method: 'POST',
      headers: await headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
    })
    return handle(res)
  },

  // upsert on a unique constraint, e.g. onConflict = 'item_id,period'
  async upsert(table, rows, onConflict) {
    const res = await fetch(
      `${REST}/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
      {
        method: 'POST',
        headers: await headers({
          Prefer: 'resolution=merge-duplicates,return=representation',
        }),
        body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
      }
    )
    return handle(res)
  },

  async update(table, filters, patch) {
    const res = await fetch(`${REST}/${table}${qs(filters)}`, {
      method: 'PATCH',
      headers: await headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(patch),
    })
    return handle(res)
  },

  async remove(table, filters) {
    const res = await fetch(`${REST}/${table}${qs(filters)}`, {
      method: 'DELETE',
      headers: await headers({ Prefer: 'return=representation' }),
    })
    return handle(res)
  },
}

// Lodges for the current company. Loaded from the shared `locations` table
// at login (see CompanyContext.jsx) instead of being hardcoded, so a second
// company's own lodges work without a code change (2026-08-26).
//
// Deliberately a MUTABLE module array rather than React state: this app
// already reads LOCATIONS synchronously in a number of places, some outside
// components, and converting every one to a hook would be a large change for
// no visible benefit today. CompanyContext fills this in BEFORE it renders
// any children, and refills it on company switch, so by the time anything
// reads it, it's correct. The array identity never changes — contents are
// replaced in place — so existing dependency arrays keep behaving as before.
export const LOCATIONS = []

// Only 'lodge' rows: the shared locations table also holds an 'overhead'
// (head office) row that the Finance Dashboard uses for non-lodge costs and
// that this app has never shown. Ordering is by created_at, not id, because
// the established display order is ZC, EC, SC — which alphabetical order
// would reshuffle to EC, SC, ZC.
export function setLocations(rows) {
  LOCATIONS.length = 0
  for (const r of rows || []) {
    if (r.type && r.type !== 'lodge') continue
    LOCATIONS.push({ id: r.id, name: r.name, type: r.type ?? null })
  }
}

export function currentPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
