import { useEffect, useMemo, useState } from 'react'
import { sb, LOCATIONS, currentPeriod } from './sb.js'

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

// ---------------------------------------------------------------------------
// Shared styles (inline CSS-in-JS, mirrors the ops app's approach)
// ---------------------------------------------------------------------------

const colors = {
  bg: '#f4f6f4',
  card: '#ffffff',
  border: '#e1e5e1',
  primary: '#12351f',
  accent: '#2f6b3f',
  danger: '#b3312c',
  warn: '#a8710a',
  text: '#1c241d',
  muted: '#6b756c',
}

const styles = {
  app: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    background: colors.bg,
    minHeight: '100vh',
    color: colors.text,
    paddingBottom: 72,
  },
  header: {
    background: colors.primary,
    color: '#fff',
    padding: '14px 16px 10px',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  headerTitle: { fontSize: 17, fontWeight: 700, marginBottom: 10 },
  row: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  pillGroup: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  pill: (active) => ({
    padding: '6px 12px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    border: '1px solid rgba(255,255,255,0.35)',
    background: active ? '#fff' : 'transparent',
    color: active ? colors.primary : '#fff',
    cursor: 'pointer',
  }),
  monthInput: {
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.35)',
    background: 'transparent',
    color: '#fff',
    fontSize: 13,
  },
  content: { padding: 14, maxWidth: 900, margin: '0 auto' },
  card: {
    background: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 14, fontWeight: 700, marginBottom: 10, color: colors.primary },
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
  input: {
    width: '100%',
    padding: '7px 9px',
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    fontSize: 13,
    boxSizing: 'border-box',
  },
  smallInput: {
    width: 80,
    padding: '5px 7px',
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    fontSize: 13,
  },
  button: {
    padding: '9px 14px',
    borderRadius: 8,
    border: 'none',
    background: colors.accent,
    color: '#fff',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
  buttonGhost: {
    padding: '9px 14px',
    borderRadius: 8,
    border: `1px solid ${colors.accent}`,
    background: 'transparent',
    color: colors.accent,
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
  buttonDanger: {
    padding: '5px 9px',
    borderRadius: 6,
    border: 'none',
    background: '#fdeceb',
    color: colors.danger,
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
  },
  banner: {
    background: '#fff6e6',
    border: '1px solid #f0d99a',
    color: colors.warn,
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
    background: '#fff',
    borderTop: `1px solid ${colors.border}`,
    display: 'flex',
    zIndex: 10,
  },
  navItem: (active) => ({
    flex: 1,
    padding: '10px 4px 8px',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: 600,
    color: active ? colors.accent : colors.muted,
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
    background: tone === 'bad' ? '#fdeceb' : tone === 'good' ? '#e9f5ec' : '#f0f0f0',
    color: tone === 'bad' ? colors.danger : tone === 'good' ? colors.accent : colors.muted,
  }),
}

const TABS = [
  { id: 'items', label: 'Items' },
  { id: 'purchases', label: 'Purchases' },
  { id: 'issues', label: 'Issues' },
  { id: 'count', label: 'Count' },
  { id: 'variance', label: 'Variance' },
  { id: 'orders', label: 'Orders' },
]

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [location, setLocation] = useState('ZC')
  const [period, setPeriod] = useState(currentPeriod())
  const [tab, setTab] = useState('variance')
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
      await sb.upsert('bev_stock_periods', rows, 'item_id,period')
      await loadAll()
    }
  }

  async function closePeriod() {
    const rows = stockPeriods.map((sp) => ({ ...sp, closed: true }))
    if (rows.length) {
      await sb.upsert('bev_stock_periods', rows, 'item_id,period')
      await loadAll()
    }
  }

  const allClosed = stockPeriods.length > 0 && stockPeriods.every((sp) => sp.closed)

  return (
    <div style={styles.app}>
      <div style={styles.header}>
        <div style={styles.headerTitle}>Crossing Lodges — Beverage Stock</div>
        <div style={styles.row}>
          <div style={styles.pillGroup}>
            {LOCATIONS.map((l) => (
              <button key={l.id} style={styles.pill(location === l.id)} onClick={() => setLocation(l.id)}>
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
          <div style={{ ...styles.banner, background: '#fdeceb', borderColor: '#f0b9b5', color: colors.danger }}>
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
            {tab === 'items' && <ItemsTab items={items} location={location} onChange={loadAll} />}
            {tab === 'purchases' && (
              <PurchasesTab items={items} purchases={purchases} location={location} period={period} onChange={loadAll} />
            )}
            {tab === 'issues' && (
              <IssuesTab items={items} issues={issues} location={location} period={period} onChange={loadAll} />
            )}
            {tab === 'count' && (
              <CountTab
                items={items}
                stockByItem={stockByItem}
                metricsByItem={metricsByItem}
                location={location}
                period={period}
                onChange={loadAll}
              />
            )}
            {tab === 'variance' && (
              <VarianceTab
                items={items}
                metricsByItem={metricsByItem}
                allClosed={allClosed}
                onClosePeriod={closePeriod}
              />
            )}
            {tab === 'orders' && <OrdersTab items={items} metricsByItem={metricsByItem} />}
          </>
        )}
      </div>

      <div style={styles.nav}>
        {TABS.map((t) => (
          <button key={t.id} style={styles.navItem(tab === t.id)} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Items tab — manage the beverage master list for the selected lodge
// ---------------------------------------------------------------------------

function ItemsTab({ items, location, onChange }) {
  const [form, setForm] = useState({
    name: '',
    category: 'Beer',
    count_unit: 'ea',
    min_units: 24,
    max_units: 72,
  })
  const [saving, setSaving] = useState(false)

  async function addItem() {
    if (!form.name.trim()) return
    setSaving(true)
    await sb.insert('bev_items', { ...form, location_id: location })
    setForm({ name: '', category: 'Beer', count_unit: 'ea', min_units: 24, max_units: 72 })
    setSaving(false)
    onChange()
  }

  async function updateItem(id, patch) {
    await sb.update('bev_items', { id }, patch)
    onChange()
  }

  async function deactivate(id) {
    await sb.update('bev_items', { id }, { active: false })
    onChange()
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
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Category</th>
              <th style={styles.th}>Unit</th>
              <th style={styles.th}>Min</th>
              <th style={styles.th}>Max</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td style={styles.td}>{it.name}</td>
                <td style={styles.td}>{it.category}</td>
                <td style={styles.td}>{it.count_unit}</td>
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
                <td style={styles.td}>
                  <button style={styles.buttonDanger} onClick={() => deactivate(it.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Purchases tab
// ---------------------------------------------------------------------------

function PurchasesTab({ items, purchases, location, period, onChange }) {
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
    await sb.insert('bev_purchases', {
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
    onChange()
  }

  async function removePurchase(id) {
    await sb.remove('bev_purchases', { id })
    onChange()
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
                <td style={styles.td}>{fmt(p.units, 0)}</td>
                <td style={styles.td}>{fmt(p.total_cost_excl_vat)}</td>
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
    </>
  )
}

// ---------------------------------------------------------------------------
// Issues tab — v1: simple daily total per item (no cost-centre breakdown yet)
// ---------------------------------------------------------------------------

function IssuesTab({ items, issues, location, period, onChange }) {
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
    await sb.insert('bev_issues', {
      item_id: form.item_id,
      location_id: location,
      period: toPeriod(form.date),
      date: form.date,
      qty: Number(form.qty),
      note: form.note,
    })
    setForm({ ...form, qty: '', note: '' })
    setSaving(false)
    onChange()
  }

  async function removeIssue(id) {
    await sb.remove('bev_issues', { id })
    onChange()
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
                <td style={styles.td}>{fmt(i.qty, 0)}</td>
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
    </>
  )
}

// ---------------------------------------------------------------------------
// Count tab — enter the physical closing stock count
// ---------------------------------------------------------------------------

function CountTab({ items, stockByItem, metricsByItem, location, period, onChange }) {
  const [countedBy, setCountedBy] = useState('')

  async function saveCount(item, value) {
    const sp = stockByItem[item.id]
    await sb.upsert(
      'bev_stock_periods',
      {
        item_id: item.id,
        location_id: location,
        period,
        opening_units: sp?.opening_units ?? 0,
        opening_cost_per_unit: sp?.opening_cost_per_unit ?? 0,
        closing_count_units: value === '' ? null : Number(value),
        counted_by: countedBy || sp?.counted_by || null,
        count_date: new Date().toISOString().slice(0, 10),
      },
      'item_id,period'
    )
    onChange()
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>Physical stock count — {period}</div>
      <div style={styles.formGrid}>
        <div>
          <label style={styles.label}>Counted by</label>
          <input style={styles.input} value={countedBy} onChange={(e) => setCountedBy(e.target.value)} placeholder="Name" />
        </div>
      </div>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Item</th>
            <th style={styles.th}>Theoretical</th>
            <th style={styles.th}>Counted</th>
            <th style={styles.th}>Variance</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const m = metricsByItem[it.id]
            const sp = stockByItem[it.id]
            return (
              <tr key={it.id}>
                <td style={styles.td}>{it.name}</td>
                <td style={styles.td}>{fmt(m?.theoreticalClosing, 1)}</td>
                <td style={styles.td}>
                  <input
                    type="number"
                    style={styles.smallInput}
                    defaultValue={sp?.closing_count_units ?? ''}
                    disabled={!sp}
                    onBlur={(e) => saveCount(it, e.target.value)}
                  />
                </td>
                <td style={styles.td}>
                  {m?.hasCount ? (
                    <span style={styles.badge(m.varianceUnits < 0 ? 'bad' : 'good')}>{fmt(m.varianceUnits, 1)}</span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
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
                <td style={styles.td}>{fmt(m.opening, 1)}</td>
                <td style={styles.td}>{fmt(m.purchaseUnits, 1)}</td>
                <td style={styles.td}>{fmt(m.issuedTotal, 1)}</td>
                <td style={styles.td}>R {fmt(m.weightedAvgCost)}</td>
                <td style={styles.td}>{fmt(m.theoreticalClosing, 1)}</td>
                <td style={styles.td}>{m.hasCount ? fmt(m.closingCount, 1) : '—'}</td>
                <td style={styles.td}>
                  {m.hasCount ? (
                    <span style={styles.badge(m.varianceUnits < 0 ? 'bad' : 'good')}>{fmt(m.varianceUnits, 1)}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={styles.td}>{m.hasCount ? `R ${fmt(m.varianceValue)}` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
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
                <td style={styles.td}>{fmt(m.theoreticalClosing, 1)}</td>
                <td style={styles.td}>{fmt(it.min_units, 0)}</td>
                <td style={styles.td}>{fmt(it.max_units, 0)}</td>
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
  )
}
