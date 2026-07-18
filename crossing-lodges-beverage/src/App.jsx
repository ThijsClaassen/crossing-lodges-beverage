import { useEffect, useMemo, useRef, useState } from 'react'
import { sb, LOCATIONS, currentPeriod } from './sb.js'
import { colors, fonts } from './theme.js'
import BarcodeScanner from './BarcodeScanner.jsx'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function prevPeriod(period) {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function toPeriod(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : currentPeriod()
}

function fmt(n, decimals = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return Number(n).toLocaleString('en-ZA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function computeMetrics(item, stockPeriod, itemPurchases, itemIssues) {
  const opening = stockPeriod?.opening_units ?? 0
  const openingCost = stockPeriod?.opening_cost_per_unit ?? 0
  const purchaseUnits = itemPurchases.reduce((s, p) => s + Number(p.units || 0), 0)
  const purchaseCost = itemPurchases.reduce((s, p) => s + Number(p.total_cost_excl_vat || 0), 0)
  const issuedTotal = itemIssues.reduce((s, i) => s + Number(i.qty || 0), 0)

  const weightedAvgCost =
    opening + purchaseUnits > 0
      ? (opening * openingCost + purchaseCost) / (opening + purchaseUnits)
      : openingCost

  const theoreticalClosing = opening + purchaseUnits - issuedTotal
  const closingCount = stockPeriod?.closing_count_units
  const hasCount = closingCount !== null && closingCount !== undefined
  const varianceUnits = hasCount ? closingCount - theoreticalClosing : null
  const varianceValue = hasCount ? varianceUnits * weightedAvgCost : null

  const reorderQty =
    theoreticalClosing <= Number(item.min_units || 0)
      ? Math.max(Number(item.max_units || 0) - theoreticalClosing, 0)
      : 0

  return {
    opening,
    openingCost,
    purchaseUnits,
    purchaseCost,
    weightedAvgCost,
    issuedTotal,
    theoreticalClosing,
    closingCount,
    hasCount,
    varianceUnits,
    varianceValue,
    reorderQty,
  }
}

// Rolls per-item metrics up into totals, split by pricing tier (Included vs
// Premium), for the Dashboard. "Actual" value uses the physical count where
// one exists this period, and falls back to the theoretical estimate for
// items that haven't been counted yet — so the total is always complete.
function aggregateValues(items, metricsByItem) {
  const blank = () => ({ theoreticalValue: 0, actualValue: 0, varianceValue: 0, issuedValue: 0 })
  const totals = { ...blank(), byTier: { Included: blank(), Premium: blank() } }

  for (const it of items) {
    const m = metricsByItem[it.id]
    if (!m) continue
    const tier = it.pricing_tier === 'Premium' ? 'Premium' : 'Included'
    const theoreticalValue = m.theoreticalClosing * m.weightedAvgCost
    const actualValue = (m.hasCount ? m.closingCount : m.theoreticalClosing) * m.weightedAvgCost
    const varianceValue = m.hasCount ? m.varianceValue : 0
    const issuedValue = m.issuedTotal * m.weightedAvgCost

    totals.theoreticalValue += theoreticalValue
    totals.actualValue += actualValue
    totals.varianceValue += varianceValue
    totals.issuedValue += issuedValue

    totals.byTier[tier].theoreticalValue += theoreticalValue
    totals.byTier[tier].actualValue += actualValue
    totals.byTier[tier].varianceValue += varianceValue
    totals.byTier[tier].issuedValue += issuedValue
  }
  return totals
}

// ---------------------------------------------------------------------------
// Shared styles (inline CSS-in-JS, mirrors the ops app's approach)
// ---------------------------------------------------------------------------

const styles = {
  app: {
    fontFamily: fonts.body,
    background: colors.bg,
    minHeight: '100vh',
    color: colors.cream,
    paddingBottom: 72,
  },
  header: {
    background: colors.panel,
    borderBottom: `1px solid ${colors.border}`,
    color: colors.cream,
    padding: '14px 16px 10px',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  headerTitle: {
    fontFamily: fonts.heading,
    fontSize: 22,
    fontWeight: 600,
    marginBottom: 10,
    color: colors.cream,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logo: { height: 28, width: 'auto', display: 'block' },
  row: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  pillGroup: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  pill: (active, locId) => ({
    padding: '6px 12px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    border: `1px solid ${locId ? colors.loc[locId] : colors.border}`,
    background: active ? (locId ? colors.loc[locId] : colors.navy) : 'transparent',
    color: active ? colors.bg : locId ? colors.loc[locId] : colors.cream,
    cursor: 'pointer',
  }),
  monthInput: {
    padding: '6px 10px',
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.cream,
    fontFamily: fonts.mono,
    fontSize: 13,
  },
  content: { padding: 14, maxWidth: 1100, margin: '0 auto', boxSizing: 'border-box' },
  card: {
    background: colors.panel,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    maxWidth: '100%',
    boxSizing: 'border-box',
  },
  tableWrap: {
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch',
    marginLeft: -14,
    marginRight: -14,
    paddingLeft: 14,
    paddingRight: 14,
  },
  cardTitle: {
    fontFamily: fonts.heading,
    fontSize: 19,
    fontWeight: 600,
    marginBottom: 10,
    color: colors.goldLt,
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left',
    padding: '6px 8px',
    borderBottom: `2px solid ${colors.border}`,
    color: colors.muted,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  td: { padding: '6px 8px', borderBottom: `1px solid ${colors.border}`, whiteSpace: 'nowrap' },
  tdNum: {
    padding: '6px 8px',
    borderBottom: `1px solid ${colors.border}`,
    whiteSpace: 'nowrap',
    fontFamily: fonts.mono,
  },
  num: { fontFamily: fonts.mono },
  input: {
    width: '100%',
    padding: '7px 9px',
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.cream,
    fontSize: 13,
    boxSizing: 'border-box',
  },
  smallInput: {
    width: 80,
    padding: '5px 7px',
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.cream,
    fontFamily: fonts.mono,
    fontSize: 13,
  },
  button: {
    padding: '9px 14px',
    borderRadius: 8,
    border: 'none',
    background: colors.navy,
    color: colors.cream,
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
  buttonGhost: {
    padding: '9px 14px',
    borderRadius: 8,
    border: `1px solid ${colors.gold}`,
    background: 'transparent',
    color: colors.goldLt,
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
  buttonDanger: {
    padding: '5px 9px',
    borderRadius: 6,
    border: 'none',
    background: 'rgba(192,88,88,0.16)',
    color: colors.danger,
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
  },
  banner: {
    background: 'rgba(184,147,90,0.12)',
    border: `1px solid ${colors.gold}`,
    color: colors.goldLt,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    fontSize: 13,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 8,
    marginBottom: 10,
  },
  label: { fontSize: 11, color: colors.muted, marginBottom: 3, display: 'block' },
  nav: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: colors.panel,
    borderTop: `1px solid ${colors.border}`,
    display: 'flex',
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch',
    zIndex: 10,
  },
  navItem: (active) => ({
    flex: '0 0 auto',
    minWidth: 72,
    padding: '10px 12px 8px',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    color: active ? colors.goldLt : colors.muted,
    cursor: 'pointer',
    background: 'none',
    border: 'none',
  }),
  badge: (tone) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    fontFamily: fonts.mono,
    background:
      tone === 'bad' ? 'rgba(192,88,88,0.16)' : tone === 'good' ? 'rgba(90,155,114,0.16)' : 'rgba(138,136,153,0.16)',
    color: tone === 'bad' ? colors.danger : tone === 'good' ? colors.ok : colors.muted,
  }),
}

const ADMIN_TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'items', label: 'Items' },
  { id: 'opening', label: 'Opening' },
  { id: 'purchases', label: 'Purchases' },
  { id: 'issues', label: 'Issues' },
  { id: 'count', label: 'Count' },
  { id: 'variance', label: 'Variance' },
  { id: 'orders', label: 'Orders' },
]

const STAFF_TABS = [
  { id: 'issues', label: 'Issues' },
  { id: 'count', label: 'Count' },
]

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function useAuth() {
  const [role, setRole] = useState(() => {
    try {
      return localStorage.getItem('bev_role') || null
    } catch {
      return null
    }
  })

  function login(r) {
    try {
      localStorage.setItem('bev_role', r)
    } catch {
      /* ignore storage errors */
    }
    setRole(r)
  }

  function logout() {
    try {
      localStorage.removeItem('bev_role')
    } catch {
      /* ignore storage errors */
    }
    setRole(null)
  }

  return { role, login, logout }
}

function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!password) return
    setChecking(true)
    setError('')
    try {
      const rows = await sb.select('bev_access', { password })
      if (rows && rows.length) {
        onLogin(rows[0].role)
      } else {
        setError('Incorrect password.')
      }
    } catch (err) {
      setError(`Could not reach the database: ${err.message}`)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div style={{ ...styles.app, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={submit} style={{ ...styles.card, width: 280 }}>
        <img
          src="/logo.png"
          alt=""
          style={{ height: 56, width: 'auto', display: 'block', margin: '0 auto 12px' }}
          onError={(e) => (e.target.style.display = 'none')}
        />
        <div style={{ ...styles.cardTitle, textAlign: 'center' }}>Crossing Lodges — Beverage Stock</div>
        <label style={styles.label}>Password</label>
        <input
          type="password"
          autoFocus
          style={styles.input}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div style={{ color: colors.danger, fontSize: 12, marginTop: 8 }}>{error}</div>}
        <button type="submit" style={{ ...styles.button, width: '100%', marginTop: 12 }} disabled={checking}>
          {checking ? 'Checking…' : 'Log in'}
        </button>
      </form>
    </div>
  )
}

export default function App() {
  const { role, login, logout } = useAuth()
  const [location, setLocation] = useState('ZC')
  const [period, setPeriod] = useState(currentPeriod())
  const [tab, setTab] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [stockPeriods, setStockPeriods] = useState([])
  const [purchases, setPurchases] = useState([])
  const [issues, setIssues] = useState([])
  const [error, setError] = useState(null)

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      const [itemsRes, spRes, purRes, issRes] = await Promise.all([
        sb.select('bev_items', { location_id: location, active: true }, { order: 'category.asc,name.asc' }),
        sb.select('bev_stock_periods', { location_id: location, period }, {}),
        sb.select('bev_purchases', { location_id: location, period }, { order: 'date.asc' }),
        sb.select('bev_issues', { location_id: location, period }, { order: 'date.asc' }),
      ])
      setItems(itemsRes || [])
      setStockPeriods(spRes || [])
      setPurchases(purRes || [])
      setIssues(issRes || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, period])

  // ---------------------------------------------------------------------------
  // Local (optimistic) state updates. Editing a single field used to call
  // loadAll(), which re-fetches everything and briefly unmounts the whole
  // screen behind a "Loading…" placeholder — painful when entering counts for
  // 100+ items in a row. These instead patch just the affected row(s) in
  // state directly from what the server handed back, so the screen never
  // blanks out and there's no extra round trip. Same "write back
  // optimistically" approach the ops app already uses.
  // ---------------------------------------------------------------------------
  function upsertLocalStockPeriods(rows) {
    const list = Array.isArray(rows) ? rows : [rows]
    setStockPeriods((prev) => {
      const map = new Map(prev.map((sp) => [`${sp.item_id}|${sp.period}`, sp]))
      for (const row of list) map.set(`${row.item_id}|${row.period}`, row)
      return Array.from(map.values())
    })
  }

  function addLocalItem(row) {
    setItems((prev) => [...prev, row])
  }
  function updateLocalItem(row) {
    setItems((prev) => prev.map((it) => (it.id === row.id ? row : it)))
  }
  function removeLocalItem(id) {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  function addLocalPurchase(row) {
    setPurchases((prev) => [...prev, row])
  }
  function removeLocalPurchase(id) {
    setPurchases((prev) => prev.filter((p) => p.id !== id))
  }

  function addLocalIssue(row) {
    setIssues((prev) => [...prev, row])
  }
  function removeLocalIssue(id) {
    setIssues((prev) => prev.filter((i) => i.id !== id))
  }

  const stockByItem = useMemo(() => {
    const map = {}
    for (const sp of stockPeriods) map[sp.item_id] = sp
    return map
  }, [stockPeriods])

  const purchasesByItem = useMemo(() => {
    const map = {}
    for (const p of purchases) (map[p.item_id] ||= []).push(p)
    return map
  }, [purchases])

  const issuesByItem = useMemo(() => {
    const map = {}
    for (const i of issues) (map[i.item_id] ||= []).push(i)
    return map
  }, [issues])

  const metricsByItem = useMemo(() => {
    const map = {}
    for (const item of items) {
      map[item.id] = computeMetrics(
        item,
        stockByItem[item.id],
        purchasesByItem[item.id] || [],
        issuesByItem[item.id] || []
      )
    }
    return map
  }, [items, stockByItem, purchasesByItem, issuesByItem])

  const periodStarted = items.length > 0 && items.every((it) => stockByItem[it.id])
  const periodPartiallyStarted =
    items.length > 0 && items.some((it) => stockByItem[it.id]) && !periodStarted

  async function startPeriod() {
    const prior = prevPeriod(period)
    const [priorSP, priorPur, priorIss] = await Promise.all([
      sb.select('bev_stock_periods', { location_id: location, period: prior }, {}),
      sb.select('bev_purchases', { location_id: location, period: prior }, {}),
      sb.select('bev_issues', { location_id: location, period: prior }, {}),
    ])
    const priorSPByItem = {}
    for (const sp of priorSP || []) priorSPByItem[sp.item_id] = sp
    const priorPurByItem = {}
    for (const p of priorPur || []) (priorPurByItem[p.item_id] ||= []).push(p)
    const priorIssByItem = {}
    for (const i of priorIss || []) (priorIssByItem[i.item_id] ||= []).push(i)

    const rows = items
      .filter((it) => !stockByItem[it.id])
      .map((it) => {
        const priorMetrics = computeMetrics(
          it,
          priorSPByItem[it.id],
          priorPurByItem[it.id] || [],
          priorIssByItem[it.id] || []
        )
        const openingUnits = priorMetrics.hasCount ? priorMetrics.closingCount : priorMetrics.theoreticalClosing
        return {
          item_id: it.id,
          location_id: location,
          period,
          opening_units: priorSPByItem[it.id] ? openingUnits : 0,
          opening_cost_per_unit: priorSPByItem[it.id] ? priorMetrics.weightedAvgCost : 0,
        }
      })
    if (rows.length) {
      const saved = await sb.upsert('bev_stock_periods', rows, 'item_id,period')
      upsertLocalStockPeriods(saved || rows)
    }
  }

  async function closePeriod() {
    const rows = stockPeriods.map((sp) => ({ ...sp, closed: true }))
    if (rows.length) {
      const saved = await sb.upsert('bev_stock_periods', rows, 'item_id,period')
      upsertLocalStockPeriods(saved || rows)
    }
  }

  const allClosed = stockPeriods.length > 0 && stockPeriods.every((sp) => sp.closed)

  if (!role) {
    return <LoginScreen onLogin={login} />
  }

  const TABS = role === 'admin' ? ADMIN_TABS : STAFF_TABS
  const activeTab = TABS.some((t) => t.id === tab) ? tab : TABS[0].id

  return (
    <div style={styles.app}>
      <div style={styles.header}>
        <div style={{ ...styles.row, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ ...styles.headerTitle, minWidth: 0, flexShrink: 1 }}>
            <img
              src="/logo.png"
              alt=""
              style={{ ...styles.logo, flexShrink: 0 }}
              onError={(e) => (e.target.style.display = 'none')}
            />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Crossing Lodges — Beverage Stock</span>
          </div>
          <div style={{ ...styles.row, flexShrink: 0 }}>
            <span style={styles.badge('neutral')}>{role === 'admin' ? 'Admin' : 'Staff'}</span>
            <button style={{ ...styles.pill(false), padding: '4px 10px' }} onClick={logout}>
              Log out
            </button>
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.pillGroup}>
            {LOCATIONS.map((l) => (
              <button key={l.id} style={styles.pill(location === l.id, l.id)} onClick={() => setLocation(l.id)}>
                {l.id}
              </button>
            ))}
          </div>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            style={styles.monthInput}
          />
        </div>
      </div>

      <div style={styles.content}>
        {error && (
          <div
            style={{
              ...styles.banner,
              background: 'rgba(192,88,88,0.12)',
              borderColor: colors.danger,
              color: colors.danger,
            }}
          >
            {error}
          </div>
        )}

        {!loading && !periodStarted && (
          <div style={styles.banner}>
            <span>
              {periodPartiallyStarted
                ? `${period} is only partly set up for ${location} — some items are missing opening stock.`
                : `${period} hasn't been started yet for ${location}. Opening stock will be carried forward from ${prevPeriod(
                    period
                  )}'s closing count (or 0 if that period has no data).`}
            </span>
            <button style={styles.button} onClick={startPeriod}>
              Start {period}
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ padding: 20, color: colors.muted }}>Loading…</div>
        ) : (
          <>
            {activeTab === 'dashboard' && role === 'admin' && (
              <DashboardTab items={items} metricsByItem={metricsByItem} period={period} />
            )}
            {activeTab === 'items' && role === 'admin' && (
              <ItemsTab
                items={items}
                metricsByItem={metricsByItem}
                location={location}
                onAdd={addLocalItem}
                onUpdate={updateLocalItem}
                onRemove={removeLocalItem}
              />
            )}
            {activeTab === 'opening' && role === 'admin' && (
              <OpeningTab
                items={items}
                stockByItem={stockByItem}
                metricsByItem={metricsByItem}
                location={location}
                period={period}
                onSave={upsertLocalStockPeriods}
              />
            )}
            {activeTab === 'purchases' && role === 'admin' && (
              <PurchasesTab
                items={items}
                purchases={purchases}
                location={location}
                period={period}
                onAdd={addLocalPurchase}
                onRemove={removeLocalPurchase}
              />
            )}
            {activeTab === 'issues' && (
              <IssuesTab
                items={items}
                issues={issues}
                location={location}
                period={period}
                onAdd={addLocalIssue}
                onRemove={removeLocalIssue}
              />
            )}
            {activeTab === 'count' && (
              <CountTab
                items={items}
                stockByItem={stockByItem}
                metricsByItem={metricsByItem}
                location={location}
                period={period}
                role={role}
                onSave={upsertLocalStockPeriods}
                onLinkItem={updateLocalItem}
              />
            )}
            {activeTab === 'variance' && role === 'admin' && (
              <VarianceTab
                items={items}
                metricsByItem={metricsByItem}
                allClosed={allClosed}
                onClosePeriod={closePeriod}
              />
            )}
            {activeTab === 'orders' && role === 'admin' && (
              <OrdersTab items={items} metricsByItem={metricsByItem} />
            )}
          </>
        )}
      </div>

      <div style={styles.nav}>
        {TABS.map((t) => (
          <button key={t.id} style={styles.navItem(activeTab === t.id)} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard tab — Admin only: stock value, Included vs Premium split, and
// which items are moving fastest / not selling at all this period.
// ---------------------------------------------------------------------------

function DashboardTab({ items, metricsByItem, period }) {
  const totals = useMemo(() => aggregateValues(items, metricsByItem), [items, metricsByItem])

  const ranked = useMemo(
    () =>
      items
        .map((it) => ({ item: it, m: metricsByItem[it.id] }))
        .filter((x) => x.m)
        .sort((a, b) => b.m.issuedTotal - a.m.issuedTotal),
    [items, metricsByItem]
  )
  const fastest = ranked.filter((x) => x.m.issuedTotal > 0).slice(0, 10)
  const notMoving = ranked.filter((x) => x.m.issuedTotal === 0)

  const tierRow = (label, key) => (
    <tr>
      <td style={styles.td}>{label}</td>
      <td style={styles.tdNum}>R {fmt(totals.byTier[key].theoreticalValue)}</td>
      <td style={styles.tdNum}>R {fmt(totals.byTier[key].actualValue)}</td>
      <td style={styles.td}>
        <span style={styles.badge(totals.byTier[key].varianceValue < 0 ? 'bad' : 'good')}>
          R {fmt(totals.byTier[key].varianceValue)}
        </span>
      </td>
      <td style={styles.tdNum}>R {fmt(totals.byTier[key].issuedValue)}</td>
    </tr>
  )

  return (
    <>
      <div style={styles.card}>
        <div style={styles.cardTitle}>Stock value — {period}</div>
        <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}></th>
              <th style={styles.th}>Theoretical value</th>
              <th style={styles.th}>Actual (counted) value</th>
              <th style={styles.th}>Value variance</th>
              <th style={styles.th}>Used this month</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={styles.td}>
                <strong>Total</strong>
              </td>
              <td style={styles.tdNum}>
                <strong>R {fmt(totals.theoreticalValue)}</strong>
              </td>
              <td style={styles.tdNum}>
                <strong>R {fmt(totals.actualValue)}</strong>
              </td>
              <td style={styles.tdNum}>
                <span style={styles.badge(totals.varianceValue < 0 ? 'bad' : 'good')}>
                  R {fmt(totals.varianceValue)}
                </span>
              </td>
              <td style={styles.tdNum}>
                <strong>R {fmt(totals.issuedValue)}</strong>
              </td>
            </tr>
            {tierRow('Included (all-inclusive)', 'Included')}
            {tierRow('Premium', 'Premium')}
          </tbody>
        </table>
        </div>
        <div style={{ fontSize: 12, color: colors.muted, marginTop: 8 }}>
          "Value variance" only reflects items that have had a physical count this period — it's the
          Rand value gap between what the books say should be on the shelf and what was actually
          counted (negative means stock is missing). Items not yet counted fall back to the
          theoretical estimate in both columns, so the totals stay complete.
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.cardTitle}>Fastest moving this period</div>
        <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Item</th>
              <th style={styles.th}>Category</th>
              <th style={styles.th}>Tier</th>
              <th style={styles.th}>Qty issued</th>
              <th style={styles.th}>Value issued</th>
            </tr>
          </thead>
          <tbody>
            {fastest.map(({ item, m }) => (
              <tr key={item.id}>
                <td style={styles.td}>{item.name}</td>
                <td style={styles.td}>{item.category}</td>
                <td style={styles.td}>{item.pricing_tier || 'Included'}</td>
                <td style={styles.tdNum}>{fmt(m.issuedTotal, 0)}</td>
                <td style={styles.tdNum}>R {fmt(m.issuedTotal * m.weightedAvgCost)}</td>
              </tr>
            ))}
            {fastest.length === 0 && (
              <tr>
                <td style={styles.td} colSpan={5}>
                  No issues logged this period yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.cardTitle}>Not moving this period ({notMoving.length})</div>
        <div style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>
          Zero issues logged so far this period — candidates to reconsider on the beverage menu.
        </div>
        <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Item</th>
              <th style={styles.th}>Category</th>
              <th style={styles.th}>Tier</th>
            </tr>
          </thead>
          <tbody>
            {notMoving.map(({ item }) => (
              <tr key={item.id}>
                <td style={styles.td}>{item.name}</td>
                <td style={styles.td}>{item.category}</td>
                <td style={styles.td}>{item.pricing_tier || 'Included'}</td>
              </tr>
            ))}
            {notMoving.length === 0 && (
              <tr>
                <td style={styles.td} colSpan={3}>
                  Everything moved at least once this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Items tab — manage the beverage master list for the selected lodge
// ---------------------------------------------------------------------------

function ItemsTab({ items, metricsByItem, location, onAdd, onUpdate, onRemove }) {
  const [form, setForm] = useState({
    name: '',
    category: 'Beer',
    count_unit: 'ea',
    pricing_tier: 'Included',
    min_units: 24,
    max_units: 72,
  })
  const [saving, setSaving] = useState(false)

  async function addItem() {
    if (!form.name.trim()) return
    setSaving(true)
    const [row] = await sb.insert('bev_items', { ...form, location_id: location })
    setForm({ name: '', category: 'Beer', count_unit: 'ea', pricing_tier: 'Included', min_units: 24, max_units: 72 })
    setSaving(false)
    onAdd(row)
  }

  async function updateItem(id, patch) {
    const [row] = await sb.update('bev_items', { id }, patch)
    onUpdate(row)
  }

  async function deactivate(id) {
    await sb.update('bev_items', { id }, { active: false })
    onRemove(id)
  }

  return (
    <>
      <div style={styles.card}>
        <div style={styles.cardTitle}>Add item</div>
        <div style={styles.formGrid}>
          <div>
            <label style={styles.label}>Name</label>
            <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label style={styles.label}>Category</label>
            <input style={styles.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
          <div>
            <label style={styles.label}>Unit</label>
            <input style={styles.input} value={form.count_unit} onChange={(e) => setForm({ ...form, count_unit: e.target.value })} />
          </div>
          <div>
            <label style={styles.label}>Pricing tier</label>
            <select
              style={styles.input}
              value={form.pricing_tier}
              onChange={(e) => setForm({ ...form, pricing_tier: e.target.value })}
            >
              <option value="Included">Included (all-inclusive)</option>
              <option value="Premium">Premium</option>
            </select>
          </div>
          <div>
            <label style={styles.label}>Min units</label>
            <input
              type="number"
              style={styles.input}
              value={form.min_units}
              onChange={(e) => setForm({ ...form, min_units: e.target.value })}
            />
          </div>
          <div>
            <label style={styles.label}>Max units</label>
            <input
              type="number"
              style={styles.input}
              value={form.max_units}
              onChange={(e) => setForm({ ...form, max_units: e.target.value })}
            />
          </div>
        </div>
        <button style={styles.button} onClick={addItem} disabled={saving}>
          {saving ? 'Adding…' : 'Add item'}
        </button>
      </div>

      <div style={styles.card}>
        <div style={styles.cardTitle}>{items.length} active items</div>
        <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Category</th>
              <th style={styles.th}>Tier</th>
              <th style={styles.th}>Unit</th>
              <th style={styles.th}>Barcode</th>
              <th style={styles.th}>Min</th>
              <th style={styles.th}>Max</th>
              <th style={styles.th}>W/Avg cost</th>
              <th style={styles.th}>Stock value</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const m = metricsByItem?.[it.id]
              const currentUnits = m ? (m.hasCount ? m.closingCount : m.theoreticalClosing) : null
              const currentValue = m ? currentUnits * m.weightedAvgCost : null
              return (
                <tr key={it.id}>
                  <td style={styles.td}>{it.name}</td>
                  <td style={styles.td}>{it.category}</td>
                  <td style={styles.td}>
                    <select
                      style={styles.smallInput}
                      defaultValue={it.pricing_tier || 'Included'}
                      onChange={(e) => updateItem(it.id, { pricing_tier: e.target.value })}
                    >
                      <option value="Included">Included</option>
                      <option value="Premium">Premium</option>
                    </select>
                  </td>
                  <td style={styles.td}>{it.count_unit}</td>
                  <td style={styles.td}>
                    <input
                      type="text"
                      style={{ ...styles.smallInput, width: 130, fontFamily: fonts.mono }}
                      defaultValue={it.barcode || ''}
                      placeholder="unlinked"
                      onBlur={(e) => updateItem(it.id, { barcode: e.target.value.trim() || null })}
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      type="number"
                      style={styles.smallInput}
                      defaultValue={it.min_units}
                      onBlur={(e) => updateItem(it.id, { min_units: Number(e.target.value) })}
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      type="number"
                      style={styles.smallInput}
                      defaultValue={it.max_units}
                      onBlur={(e) => updateItem(it.id, { max_units: Number(e.target.value) })}
                    />
                  </td>
                  <td style={styles.tdNum}>{m ? `R ${fmt(m.weightedAvgCost)}` : '—'}</td>
                  <td style={styles.tdNum}>{m ? `R ${fmt(currentValue)}` : '—'}</td>
                  <td style={styles.td}>
                    <button style={styles.buttonDanger} onClick={() => deactivate(it.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Opening tab — set/correct opening stock units and opening cost per unit
// for the current period. Needed because "Start period" only auto-fills
// these (from the prior period, or 0 for a brand-new item/first month) —
// there was previously no way to enter or fix the real starting values.
// ---------------------------------------------------------------------------

function OpeningTab({ items, stockByItem, metricsByItem, location, period, onSave }) {
  async function saveOpening(item, field, value) {
    const sp = stockByItem[item.id]
    if (!sp) return
    const saved = await sb.upsert(
      'bev_stock_periods',
      {
        item_id: item.id,
        location_id: location,
        period,
        opening_units: field === 'opening_units' ? Number(value || 0) : sp.opening_units,
        opening_cost_per_unit:
          field === 'opening_cost_per_unit' ? Number(value || 0) : sp.opening_cost_per_unit,
        closing_count_units: sp.closing_count_units,
        counted_by: sp.counted_by,
        count_date: sp.count_date,
        closed: sp.closed,
      },
      'item_id,period'
    )
    onSave(saved?.[0] || { ...sp, [field]: Number(value || 0) })
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>Opening stock — {period}</div>
      <div style={{ fontSize: 12, color: colors.muted, marginBottom: 10 }}>
        These values feed the weighted-average cost and theoretical closing stock for this period.
        "Start {period}" has to be run first (see the banner above) before an item shows up here as
        editable.
      </div>
      <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Item</th>
            <th style={styles.th}>Opening units</th>
            <th style={styles.th}>Opening cost/unit</th>
            <th style={styles.th}>Current W/Avg cost</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const sp = stockByItem[it.id]
            const m = metricsByItem[it.id]
            return (
              <tr key={it.id}>
                <td style={styles.td}>{it.name}</td>
                <td style={styles.td}>
                  <input
                    type="number"
                    style={styles.smallInput}
                    defaultValue={sp?.opening_units ?? ''}
                    disabled={!sp || sp.closed}
                    onBlur={(e) => saveOpening(it, 'opening_units', e.target.value)}
                  />
                </td>
                <td style={styles.td}>
                  <input
                    type="number"
                    style={styles.smallInput}
                    defaultValue={sp?.opening_cost_per_unit ?? ''}
                    disabled={!sp || sp.closed}
                    onBlur={(e) => saveOpening(it, 'opening_cost_per_unit', e.target.value)}
                  />
                </td>
                <td style={styles.tdNum}>{m ? `R ${fmt(m.weightedAvgCost)}` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Purchases tab
// ---------------------------------------------------------------------------

function PurchasesTab({ items, purchases, location, period, onAdd, onRemove }) {
  const [form, setForm] = useState({
    item_id: items[0]?.id || '',
    date: new Date().toISOString().slice(0, 10),
    units: '',
    total_cost_excl_vat: '',
    supplier: '',
  })
  const [saving, setSaving] = useState(false)

  async function addPurchase() {
    if (!form.item_id || !form.units) return
    setSaving(true)
    const [row] = await sb.insert('bev_purchases', {
      item_id: form.item_id,
      location_id: location,
      period: toPeriod(form.date),
      date: form.date,
      units: Number(form.units),
      total_cost_excl_vat: Number(form.total_cost_excl_vat || 0),
      supplier: form.supplier,
    })
    setForm({ ...form, units: '', total_cost_excl_vat: '', supplier: '' })
    setSaving(false)
    onAdd(row)
  }

  async function removePurchase(id) {
    await sb.remove('bev_purchases', { id })
    onRemove(id)
  }

  const itemName = (id) => items.find((i) => i.id === id)?.name || '—'

  return (
    <>
      <div style={styles.card}>
        <div style={styles.cardTitle}>Log a purchase</div>
        <div style={styles.formGrid}>
          <div>
            <label style={styles.label}>Item</label>
            <select style={styles.input} value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })}>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={styles.label}>Date</label>
            <input type="date" style={styles.input} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label style={styles.label}>Units</label>
            <input
              type="number"
              style={styles.input}
              value={form.units}
              onChange={(e) => setForm({ ...form, units: e.target.value })}
            />
          </div>
          <div>
            <label style={styles.label}>Total cost (excl. VAT)</label>
            <input
              type="number"
              style={styles.input}
              value={form.total_cost_excl_vat}
              onChange={(e) => setForm({ ...form, total_cost_excl_vat: e.target.value })}
            />
          </div>
          <div>
            <label style={styles.label}>Supplier</label>
            <input style={styles.input} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
          </div>
        </div>
        <button style={styles.button} onClick={addPurchase} disabled={saving}>
          {saving ? 'Saving…' : 'Add purchase'}
        </button>
      </div>

      <div style={styles.card}>
        <div style={styles.cardTitle}>Purchases in {period}</div>
        <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Date</th>
              <th style={styles.th}>Item</th>
              <th style={styles.th}>Units</th>
              <th style={styles.th}>Cost</th>
              <th style={styles.th}>Supplier</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id}>
                <td style={styles.td}>{p.date}</td>
                <td style={styles.td}>{itemName(p.item_id)}</td>
                <td style={styles.tdNum}>{fmt(p.units, 0)}</td>
                <td style={styles.tdNum}>{fmt(p.total_cost_excl_vat)}</td>
                <td style={styles.td}>{p.supplier || '—'}</td>
                <td style={styles.td}>
                  <button style={styles.buttonDanger} onClick={() => removePurchase(p.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {purchases.length === 0 && (
              <tr>
                <td style={styles.td} colSpan={6}>
                  No purchases logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Issues tab — v1: simple daily total per item (no cost-centre breakdown yet)
// ---------------------------------------------------------------------------

function IssuesTab({ items, issues, location, period, onAdd, onRemove }) {
  const [form, setForm] = useState({
    item_id: items[0]?.id || '',
    date: new Date().toISOString().slice(0, 10),
    qty: '',
    note: '',
  })
  const [saving, setSaving] = useState(false)

  async function addIssue() {
    if (!form.item_id || !form.qty) return
    setSaving(true)
    const [row] = await sb.insert('bev_issues', {
      item_id: form.item_id,
      location_id: location,
      period: toPeriod(form.date),
      date: form.date,
      qty: Number(form.qty),
      note: form.note,
    })
    setForm({ ...form, qty: '', note: '' })
    setSaving(false)
    onAdd(row)
  }

  async function removeIssue(id) {
    await sb.remove('bev_issues', { id })
    onRemove(id)
  }

  const itemName = (id) => items.find((i) => i.id === id)?.name || '—'

  return (
    <>
      <div style={styles.card}>
        <div style={styles.cardTitle}>Log issued stock</div>
        <div style={{ fontSize: 12, color: colors.muted, marginBottom: 10 }}>
          v1 tracks a simple daily total per item. Breaking this down by cost centre (Kitchen, Guest
          Groups, Staff, etc.) can be added later without changing this table's structure.
        </div>
        <div style={styles.formGrid}>
          <div>
            <label style={styles.label}>Item</label>
            <select style={styles.input} value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })}>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={styles.label}>Date</label>
            <input type="date" style={styles.input} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label style={styles.label}>Qty issued</label>
            <input type="number" style={styles.input} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
          </div>
          <div>
            <label style={styles.label}>Note (optional)</label>
            <input style={styles.input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
        </div>
        <button style={styles.button} onClick={addIssue} disabled={saving}>
          {saving ? 'Saving…' : 'Add issue'}
        </button>
      </div>

      <div style={styles.card}>
        <div style={styles.cardTitle}>Issues in {period}</div>
        <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Date</th>
              <th style={styles.th}>Item</th>
              <th style={styles.th}>Qty</th>
              <th style={styles.th}>Note</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {issues.map((i) => (
              <tr key={i.id}>
                <td style={styles.td}>{i.date}</td>
                <td style={styles.td}>{itemName(i.item_id)}</td>
                <td style={styles.tdNum}>{fmt(i.qty, 0)}</td>
                <td style={styles.td}>{i.note || '—'}</td>
                <td style={styles.td}>
                  <button style={styles.buttonDanger} onClick={() => removeIssue(i.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {issues.length === 0 && (
              <tr>
                <td style={styles.td} colSpan={5}>
                  No issues logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Count tab — enter the physical closing stock count
// ---------------------------------------------------------------------------

function CountTab({ items, stockByItem, metricsByItem, location, period, role, onSave, onLinkItem }) {
  const [countedBy, setCountedBy] = useState('')
  const [resetKey, setResetKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState('')
  const [scanning, setScanning] = useState(false)
  const [activeScanItemId, setActiveScanItemId] = useState(null)
  const [linkingBarcode, setLinkingBarcode] = useState(null)
  const [linkItemId, setLinkItemId] = useState('')
  const [linking, setLinking] = useState(false)
  const inputRefs = useRef({})
  const showTheoretical = role === 'admin'

  function focusItem(id) {
    setActiveScanItemId(id)
    // Let the row render before focusing — the input may have just remounted.
    setTimeout(() => {
      const el = inputRefs.current[id]
      if (el) {
        el.focus()
        el.select?.()
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 50)
  }

  function handleScan(code) {
    const match = items.find((it) => it.barcode === code)
    setScanning(false)
    if (match) {
      setLinkingBarcode(null)
      setStatus(`Scanned: ${match.name} — type the count and press Enter to scan the next item.`)
      focusItem(match.id)
    } else {
      setStatus('')
      setLinkingBarcode(code)
      setLinkItemId('')
    }
  }

  async function linkBarcode() {
    if (!linkItemId || !linkingBarcode) return
    setLinking(true)
    const [row] = await sb.update('bev_items', { id: linkItemId }, { barcode: linkingBarcode })
    onLinkItem(row)
    setLinking(false)
    setLinkingBarcode(null)
    setStatus(`Linked to ${row?.name || 'item'} — scan it again next time to jump straight there.`)
    focusItem(linkItemId)
    setLinkItemId('')
  }

  function handleCountKeyDown(e, itemId) {
    if (e.key === 'Enter' && activeScanItemId === itemId) {
      e.preventDefault()
      e.target.blur()
      setScanning(true)
    }
  }

  // Fields start blank every time (last count shown only as a faint
  // placeholder hint) and stay untouched in the database until "Submit
  // count" is pressed — that way partial progress isn't silently written
  // field-by-field, and hitting Submit both saves everything in one go and
  // clears the sheet so it's ready for the next count.
  async function submitCounts() {
    setSubmitting(true)
    setStatus('')
    const rows = []
    for (const it of items) {
      const sp = stockByItem[it.id]
      if (!sp) continue
      const el = inputRefs.current[it.id]
      const raw = el ? el.value.trim() : ''
      if (raw === '') continue
      rows.push({
        item_id: it.id,
        location_id: location,
        period,
        opening_units: sp.opening_units ?? 0,
        opening_cost_per_unit: sp.opening_cost_per_unit ?? 0,
        closing_count_units: Number(raw),
        counted_by: countedBy || sp.counted_by || null,
        count_date: new Date().toISOString().slice(0, 10),
      })
    }

    if (rows.length) {
      const saved = await sb.upsert('bev_stock_periods', rows, 'item_id,period')
      onSave(saved || rows)
      setStatus(`Saved ${rows.length} count${rows.length === 1 ? '' : 's'} — sheet cleared for the next count.`)
    } else {
      setStatus('Nothing to save — every field was empty.')
    }
    setSubmitting(false)
    setResetKey((k) => k + 1) // remounts every input blank, whether or not it was saved
  }

  return (
    <div style={styles.card}>
      <div style={{ ...styles.row, justifyContent: 'space-between' }}>
        <div style={styles.cardTitle}>Physical stock count — {period}</div>
        <button style={styles.buttonGhost} onClick={() => setScanning(true)}>
          Scan barcode
        </button>
      </div>
      <div style={{ fontSize: 12, color: colors.muted, marginBottom: 10 }}>
        Fields start empty each time — the grey number is just a reminder of the last count, not a
        live value. Fill in what you're counting today, then hit Submit; anything left blank is
        skipped and keeps its last saved count. Scanning a bottle jumps straight to its row —
        type the count and press Enter to scan the next one.
      </div>
      <div style={styles.formGrid}>
        <div>
          <label style={styles.label}>Counted by</label>
          <input style={styles.input} value={countedBy} onChange={(e) => setCountedBy(e.target.value)} placeholder="Name" />
        </div>
      </div>

      {linkingBarcode && (
        <div style={styles.banner}>
          <span>Unknown barcode ({linkingBarcode}) — link it to an item:</span>
          <div style={{ ...styles.row, flexWrap: 'wrap' }}>
            <select style={styles.input} value={linkItemId} onChange={(e) => setLinkItemId(e.target.value)}>
              <option value="">Choose item…</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
            <button style={styles.button} onClick={linkBarcode} disabled={!linkItemId || linking}>
              {linking ? 'Linking…' : 'Link'}
            </button>
            <button style={styles.buttonGhost} onClick={() => setLinkingBarcode(null)}>
              Skip
            </button>
          </div>
        </div>
      )}

      <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Item</th>
            {showTheoretical && <th style={styles.th}>Theoretical</th>}
            <th style={styles.th}>Counted</th>
            {showTheoretical && <th style={styles.th}>Variance</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const m = metricsByItem[it.id]
            const sp = stockByItem[it.id]
            const active = activeScanItemId === it.id
            return (
              <tr key={it.id} style={active ? { background: 'rgba(184,147,90,0.14)' } : undefined}>
                <td style={styles.td}>
                  {it.name}
                  {it.barcode && (
                    <span style={{ ...styles.badge('neutral'), marginLeft: 6, fontSize: 9 }}>linked</span>
                  )}
                </td>
                {showTheoretical && <td style={styles.tdNum}>{fmt(m?.theoreticalClosing, 1)}</td>}
                <td style={styles.td}>
                  <input
                    key={`${it.id}-${resetKey}`}
                    ref={(el) => {
                      inputRefs.current[it.id] = el
                    }}
                    type="number"
                    style={styles.smallInput}
                    defaultValue=""
                    placeholder={sp?.closing_count_units ?? ''}
                    disabled={!sp}
                    onKeyDown={(e) => handleCountKeyDown(e, it.id)}
                  />
                </td>
                {showTheoretical && (
                  <td style={styles.td}>
                    {m?.hasCount ? (
                      <span style={styles.badge(m.varianceUnits < 0 ? 'bad' : 'good')}>{fmt(m.varianceUnits, 1)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
      <div style={{ ...styles.row, justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: colors.muted }}>{status}</div>
        <button style={styles.button} onClick={submitCounts} disabled={submitting}>
          {submitting ? 'Saving…' : 'Submit count'}
        </button>
      </div>

      {scanning && <BarcodeScanner onScan={handleScan} onClose={() => setScanning(false)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Variance tab — the core costing/variance engine output
// ---------------------------------------------------------------------------

function VarianceTab({ items, metricsByItem, allClosed, onClosePeriod }) {
  const totals = items.reduce(
    (acc, it) => {
      const m = metricsByItem[it.id]
      acc.purchaseCost += m?.purchaseCost || 0
      acc.varianceValue += m?.varianceValue || 0
      return acc
    },
    { purchaseCost: 0, varianceValue: 0 }
  )

  return (
    <div style={styles.card}>
      <div style={{ ...styles.row, justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={styles.cardTitle}>Variance & weighted-average cost</div>
        <button style={styles.buttonGhost} onClick={onClosePeriod} disabled={allClosed}>
          {allClosed ? 'Period closed' : 'Close period'}
        </button>
      </div>
      <div style={{ fontSize: 12, color: colors.muted, marginBottom: 10 }}>
        Total purchases this period: R {fmt(totals.purchaseCost)} · Total variance value: R {fmt(totals.varianceValue)}
      </div>
      <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Item</th>
            <th style={styles.th}>Opening</th>
            <th style={styles.th}>Purchased</th>
            <th style={styles.th}>Issued</th>
            <th style={styles.th}>W/Avg cost</th>
            <th style={styles.th}>Theoretical</th>
            <th style={styles.th}>Counted</th>
            <th style={styles.th}>Variance (units)</th>
            <th style={styles.th}>Variance (value)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const m = metricsByItem[it.id]
            if (!m) return null
            return (
              <tr key={it.id}>
                <td style={styles.td}>{it.name}</td>
                <td style={styles.tdNum}>{fmt(m.opening, 1)}</td>
                <td style={styles.tdNum}>{fmt(m.purchaseUnits, 1)}</td>
                <td style={styles.tdNum}>{fmt(m.issuedTotal, 1)}</td>
                <td style={styles.tdNum}>R {fmt(m.weightedAvgCost)}</td>
                <td style={styles.tdNum}>{fmt(m.theoreticalClosing, 1)}</td>
                <td style={styles.td}>{m.hasCount ? fmt(m.closingCount, 1) : '—'}</td>
                <td style={styles.td}>
                  {m.hasCount ? (
                    <span style={styles.badge(m.varianceUnits < 0 ? 'bad' : 'good')}>{fmt(m.varianceUnits, 1)}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={styles.tdNum}>{m.hasCount ? `R ${fmt(m.varianceValue)}` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Orders tab — items at/below their reorder point
// ---------------------------------------------------------------------------

function OrdersTab({ items, metricsByItem }) {
  const toOrder = items.filter((it) => (metricsByItem[it.id]?.reorderQty || 0) > 0)

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>To be ordered ({toOrder.length})</div>
      <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Item</th>
            <th style={styles.th}>Theoretical stock</th>
            <th style={styles.th}>Min</th>
            <th style={styles.th}>Max</th>
            <th style={styles.th}>Order qty</th>
          </tr>
        </thead>
        <tbody>
          {toOrder.map((it) => {
            const m = metricsByItem[it.id]
            return (
              <tr key={it.id}>
                <td style={styles.td}>{it.name}</td>
                <td style={styles.tdNum}>{fmt(m.theoreticalClosing, 1)}</td>
                <td style={styles.tdNum}>{fmt(it.min_units, 0)}</td>
                <td style={styles.tdNum}>{fmt(it.max_units, 0)}</td>
                <td style={styles.td}>
                  <strong>{fmt(m.reorderQty, 0)}</strong>
                </td>
              </tr>
            )
          })}
          {toOrder.length === 0 && (
            <tr>
              <td style={styles.td} colSpan={5}>
                Nothing needs ordering right now.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  )
}
