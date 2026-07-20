import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
         ResponsiveContainer, PieChart, Pie, Cell, Sector } from 'recharts'
import { useEffect, useState, useCallback } from 'react'

/* ─── BA normalization (mirrors Python BA_ALIASES) ────────────────────────── */
const BA_ALIASES = {
  'CPX': 'Common Product Experience',
  'Common product experience': 'Common Product Experience',
  'common product experience': 'Common Product Experience',
  'Unsecured Loans': 'Unsecured Lending',
  'unsecured loans': 'Unsecured Lending',
  'Lending PJ': 'PJ Lending',
  'lending pj': 'PJ Lending',
  'Lending Foundations': 'Lending Foundations Platforms',
  'lending foundations': 'Lending Foundations Platforms',
}
const normalizeBA = ba => BA_ALIASES[ba] || ba

/* Format an ISO date (YYYY-MM-DD) as "31 Aug 2026"; returns null if empty/invalid */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtDue = iso => {
  if (!iso) return null
  const [y, m, d] = String(iso).split('-')
  if (!y || !m || !d) return null
  return `${+d} ${MONTHS[+m - 1]} ${y}`
}

/* Sort drilldown items by due date, nearest first; items without a date go last */
const byDueDate = (a, b) => {
  const av = a.dueDate || '', bv = b.dueDate || ''
  if (!av && !bv) return 0
  if (!av) return 1
  if (!bv) return -1
  return av < bv ? -1 : av > bv ? 1 : 0
}

/* Days between today and an ISO due date (negative = overdue) */
const SOON_THRESHOLD_DAYS = 14
const daysUntil = iso => {
  if (!iso) return null
  const due = new Date(`${iso}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((due - today) / 86400000)
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function AnimatedNumber({ value, color, size = 44 }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    let s = 0
    const step = () => {
      s += Math.ceil((value - s) / 6)
      setDisplay(s)
      if (s < value) requestAnimationFrame(step)
      else setDisplay(value)
    }
    requestAnimationFrame(step)
  }, [value])
  return <span style={{ color, fontSize: size, fontWeight: 800, lineHeight: 1 }}>{display}</span>
}

/* ─── KPI Card — late number BIG, total small ────────────────────────────── */
function KPICard({ label, total, late, color, icon }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '20px 24px', flex: '1 1 160px',
      boxShadow: '0 1px 6px rgba(0,0,0,0.07)', border: `1px solid ${color}22`,
      position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4,
        background: color, borderRadius: '16px 16px 0 0' }} />
      <div style={{ fontSize: 13, color: '#6B6B80', marginBottom: 8 }}>{icon} {label}</div>
      {/* Late — BIG */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <AnimatedNumber value={late} color={late > 0 ? color : '#007A57'} size={48} />
        <span style={{ fontSize: 13, color: late > 0 ? color : '#007A57', fontWeight: 700 }}>late</span>
      </div>
      {/* Total — small */}
      <div style={{ marginTop: 6, fontSize: 13, color: '#6B6B80' }}>
        <AnimatedNumber value={total} color="#6B6B80" size={18} />
        <span style={{ marginLeft: 4 }}>total</span>
      </div>
    </div>
  )
}

/* ─── Status Donut ────────────────────────────────────────────────────────── */
const DONUT_COLORS = { Late: '#E0002A', TBD: '#D48000', 'On Track': '#007A57', 'In Validation': '#1A6FCC' }
const RATING_COLORS = { 'Very High': '#9B0020', High: '#E0002A', Medium: '#D48000', Low: '#1A6FCC' }
const RATINGS_ORDER = ['Very High', 'High', 'Medium', 'Low']
const ORIGIN_COLORS = { 'Self-Identified': '#007A57', 'Defense Assessment': '#8A05BE', 'Internal Audit': '#1A6FCC', 'External Parties': '#E0002A', "Regulator's Finding": '#D48000', Unknown: '#6B6B80' }
const ORIGINS_ORDER = ['Self-Identified', 'Defense Assessment', 'Internal Audit', 'External Parties', "Regulator's Finding", 'Unknown']
const tooltipStyle = { background: '#fff', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: 12 }

/* Diagonal-stripe SVG pattern (mirrors the CSS repeating-linear-gradient used
   for "potential" bars elsewhere) so recharts SVG shapes can render the same
   solid = confirmed / striped = potential language. */
const patternId = color => `stripe-${color.replace('#', '')}`
function StripeDefs({ colors }) {
  return (
    <defs>
      {colors.map(c => (
        <pattern key={c} id={patternId(c)} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
          <rect width={6} height={6} fill="#F0EDF5" />
          <rect width={2} height={6} fill={c} />
        </pattern>
      ))}
    </defs>
  )
}
const fillFor = (color, isPotential) => isPotential ? `url(#${patternId(color)})` : color

function ActiveShape({ cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, value }) {
  return (
    <g>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius - 4} outerRadius={outerRadius + 8}
        startAngle={startAngle} endAngle={endAngle} fill={fill} />
      <text x={cx} y={cy - 10} textAnchor="middle" fill="#1A1A2E" fontSize={28} fontWeight={800}>{value}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fill="#6B6B80" fontSize={12}>
        {payload.name}{payload.isPotential ? ' · potential' : ''}
      </text>
    </g>
  )
}

/* confirmedRows/potentialRows: arrays of items with a `.status` field.
   Renders one wedge per status (solid) immediately followed by a striped
   wedge for its potential-issue share — same "riscadinho" language as the
   Risk Rating bars, but merged into a single donut instead of two. */
function StatusDonut({ confirmedRows, potentialRows, selectedStatus, onSelect, title = 'Issue Status', subtitle = 'click to filter', height = 220 }) {
  const [activeIndex, setActiveIndex] = useState(null)

  const statusNames = [...new Set([...confirmedRows.map(r => r.status), ...potentialRows.map(r => r.status)])]
  const counts = statusNames
    .map(name => ({
      name,
      confirmed: confirmedRows.filter(r => r.status === name).length,
      potential: potentialRows.filter(r => r.status === name).length,
    }))
    .map(c => ({ ...c, total: c.confirmed + c.potential }))
    .sort((a, b) => b.total - a.total)

  const slices = []
  counts.forEach(({ name, confirmed, potential }) => {
    if (confirmed > 0) slices.push({ name, value: confirmed, isPotential: false })
    if (potential > 0) slices.push({ name, value: potential, isPotential: true })
  })

  const handleClick = useCallback((_, index) => {
    const s = slices[index]?.name
    onSelect(prev => prev === s ? null : s)
  }, [slices, onSelect])

  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '20px 24px',
      boxShadow: '0 1px 6px rgba(0,0,0,0.07)', border: '1px solid rgba(0,0,0,0.06)' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1A1A2E' }}>{title}</div>
        <div style={{ fontSize: 11, color: '#6B6B80', marginTop: 2 }}>{subtitle}</div>
      </div>
      {slices.length === 0
        ? <div style={{ padding: '32px 0', textAlign: 'center', color: '#6B6B80', fontSize: 13 }}>No items</div>
        : <>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <StripeDefs colors={Object.values(DONUT_COLORS)} />
          <Pie data={slices} cx="50%" cy="50%" innerRadius={Math.round(height * 0.25)} outerRadius={Math.round(height * 0.386)} paddingAngle={2}
            dataKey="value" activeIndex={activeIndex} activeShape={ActiveShape}
            onMouseEnter={(_, i) => setActiveIndex(i)} onMouseLeave={() => setActiveIndex(null)}
            onClick={handleClick} style={{ cursor: 'pointer' }}>
            {slices.map((entry, i) => {
              const color = DONUT_COLORS[entry.name] || '#8A05BE'
              const dimmed = selectedStatus && selectedStatus !== entry.name
              return (
                <Cell key={i} fill={fillFor(color, entry.isPotential)}
                  opacity={dimmed ? 0.3 : 1}
                  stroke={selectedStatus === entry.name ? '#1A1A2E' : 'none'}
                  strokeWidth={selectedStatus === entry.name ? 2 : 0} />
              )
            })}
          </Pie>
          <Tooltip contentStyle={tooltipStyle}
            formatter={(value, name, { payload }) => [value, `${name}${payload.isPotential ? ' (potential)' : ''}`]} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 4 }}>
        {counts.map(({ name, total, potential }) => {
          const c = DONUT_COLORS[name] || '#8A05BE'
          const active = selectedStatus === name
          return (
            <button key={name} onClick={() => onSelect(p => p === name ? null : name)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20,
                background: active ? c + '20' : '#F5F5F8', border: active ? `1.5px solid ${c}` : '1.5px solid transparent',
                cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 400,
                color: active ? c : '#6B6B80', transition: 'all 0.15s' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, display: 'inline-block' }} />
              {name} ({total - potential} I{potential > 0 ? ` · ${potential} P` : ''})
            </button>
          )
        })}
      </div>
      <IssueTypeLegend />
      </>
      }
    </div>
  )
}

/* ─── Custom tooltip for the stacked BA bar chart (readable status + I/P labels) ── */
function BATooltip({ active, payload, label, colorMap = DONUT_COLORS }) {
  if (!active || !payload?.length) return null
  const rows = payload.filter(p => p.value > 0)
  if (!rows.length) return null
  return (
    <div style={{ ...tooltipStyle, padding: '8px 12px' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {rows.map(p => {
        const isPotential = p.dataKey.endsWith('_p')
        const status = p.dataKey.replace(/_[cp]$/, '')
        const color = colorMap[status] || '#6B6B80'
        return (
          <div key={p.dataKey} style={{ color }}>
            {status} ({isPotential ? 'Potential' : 'Issue'}): {p.value}
          </div>
        )
      })}
    </div>
  )
}

/* ─── Issue vs Potential Issue legend (solid = issue, striped = potential) ──── */
function IssueTypeLegend({ justify = 'center' }) {
  return (
    <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 10.5, color: '#6B6B80', justifyContent: justify, flexWrap: 'wrap' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 16, height: 8, borderRadius: 2, background: '#6B6B80', display: 'inline-block' }} /> Issue
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 16, height: 8, borderRadius: 2, display: 'inline-block',
          backgroundImage: 'repeating-linear-gradient(45deg, #6B6B80 0, #6B6B80 2px, #F0EDF5 2px, #F0EDF5 5px)' }} /> Potential issue
      </span>
    </div>
  )
}

/* ─── Active filter pills ─────────────────────────────────────────────────── */
function FilterPill({ label, color, onClear }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11,
      color, fontWeight: 600, background: color + '15', padding: '3px 10px',
      borderRadius: 20, border: `1px solid ${color}44` }}>
      {label}
      <button onClick={onClear} style={{ background: 'none', border: 'none', color, cursor: 'pointer',
        fontSize: 14, padding: 0, lineHeight: 1, fontWeight: 700 }}>×</button>
    </span>
  )
}

/* ─── Chart wrapper ───────────────────────────────────────────────────────── */
function ChartCard({ title, subtitle, right, children, fill }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '20px 24px',
      boxShadow: '0 1px 6px rgba(0,0,0,0.07)', border: '1px solid rgba(0,0,0,0.06)',
      height: fill ? '100%' : undefined, display: fill ? 'flex' : undefined, flexDirection: fill ? 'column' : undefined }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1A1A2E' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: '#6B6B80', marginTop: 2 }}>{subtitle}</div>}
        </div>
        {right}
      </div>
      {fill ? <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>{children}</div> : children}
    </div>
  )
}

/* ─── Custom Y-axis tick that highlights selected BA ─────────────────────── */
function BAYTick({ x, y, payload, selectedBA }) {
  const label = payload.value.length > 28 ? payload.value.slice(0, 26) + '…' : payload.value
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={9}
      fill={selectedBA === payload.value ? '#8A05BE' : '#1A1A2E'}
      fontWeight={selectedBA === payload.value ? 700 : 400}>
      {label}
    </text>
  )
}

/* ─── BA Table with drilldown ─────────────────────────────────────────────── */
function BATable({ issues, aps, selectedBA, onSelectBA }) {
  const [drilldown, setDrilldown] = useState(null) // { ba, label, items: [{code, summary, link}] }

  const allBAs = [...new Set(
    [...issues.map(i => normalizeBA(i['Business Area'] || '')), ...aps.map(a => normalizeBA(a['Business Area'] || ''))].filter(Boolean)
  )].sort()

  const openDrilldown = (e, ba, label, items) => {
    e.stopPropagation()
    setDrilldown(prev => prev?.ba === ba && prev?.label === label ? null : { ba, label, items })
  }

  const CountCell = ({ items, label, ba, color }) => {
    const n = items.length
    const isOpen = drilldown?.ba === ba && drilldown?.label === label
    return (
      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
        {n > 0
          ? <button onClick={e => openDrilldown(e, ba, label, items)}
              style={{ background: isOpen ? (color || '#8A05BE') + '20' : 'none', border: 'none',
                color: color || '#E0002A', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                borderRadius: 6, padding: '2px 8px', textDecoration: 'underline dotted' }}>
              {n}
            </button>
          : <span style={{ color: '#6B6B80' }}>0</span>
        }
      </td>
    )
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid rgba(138,5,190,0.15)' }}>
              {['Business Area', 'Issues', 'Late Issues', 'Pot. Issues', 'Late Pot.', 'APs', 'Late APs', 'Pending APs'].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Business Area' ? 'left' : 'center',
                  fontSize: 11, fontWeight: 600, color: '#6B6B80', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allBAs.map((ba, idx) => {
              const baIssues  = issues.filter(x => normalizeBA(x['Business Area']) === ba && x.Type === 'Issue')
              const baPot     = issues.filter(x => normalizeBA(x['Business Area']) === ba && x.Type === 'Potential Issue')
              const baAPs     = aps.filter(x => normalizeBA(x['Business Area']) === ba)
              const lateI     = baIssues.filter(x => x.status === 'Late')
              const latePot   = baPot.filter(x => x.status === 'Late')
              const lateAP    = baAPs.filter(x => x.ap_status === 'Late')
              const pendingAP = baAPs.filter(x => ['Pending Approval', 'Pending Approval (late)', 'Pending Validation', 'Pending Validation (late)'].includes(x.ap_status))
              const isSelected = selectedBA === ba

              const toIssueItems = rows => rows.map(r => ({ code: r.code, summary: r.summary, link: r.projac_link }))
              const toAPItems    = rows => rows.map(r => ({ code: r.ap_code, summary: r.ap_summary, link: r.ap_link_projac, issueCode: r['Issue Code'], issueLink: r.issue_link_projac }))

              return (
                <tr key={ba} onClick={() => onSelectBA(p => p === ba ? null : ba)}
                  style={{ background: isSelected ? '#8A05BE0D' : idx % 2 === 0 ? '#FAFAFA' : '#fff',
                    borderBottom: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer',
                    outline: isSelected ? '2px solid #8A05BE33' : 'none', transition: 'background 0.15s' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: isSelected ? '#8A05BE' : '#1A1A2E' }}>{ba}</td>
                  <CountCell items={toIssueItems(baIssues)} label="Issues"      ba={ba} color="#1A6FCC" />
                  <CountCell items={toIssueItems(lateI)}    label="Late Issues"  ba={ba} color="#E0002A" />
                  <CountCell items={toIssueItems(baPot)}    label="Pot. Issues" ba={ba} color="#D48000" />
                  <CountCell items={toIssueItems(latePot)}  label="Late Pot."   ba={ba} color="#E0002A" />
                  <CountCell items={toAPItems(baAPs)}       label="APs"         ba={ba} color="#8A05BE" />
                  <CountCell items={toAPItems(lateAP)}      label="Late APs"    ba={ba} color="#E0002A" />
                  <CountCell items={toAPItems(pendingAP)}   label="Pending APs" ba={ba} color="#D48000" />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Drilldown panel */}
      {drilldown && (
        <div style={{ marginTop: 12, background: '#F8F7FB', border: '1.5px solid #8A05BE33',
          borderRadius: 12, padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1A1A2E' }}>
              {drilldown.label} — {drilldown.ba} ({drilldown.items.length})
            </span>
            <button onClick={() => setDrilldown(null)} style={{ background: 'none', border: 'none',
              fontSize: 18, cursor: 'pointer', color: '#6B6B80', lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {drilldown.items.map((item, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: 8, padding: '10px 14px',
                border: '1px solid rgba(0,0,0,0.07)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ minWidth: 100 }}>
                  <a href={item.link} target="_blank" rel="noreferrer"
                    style={{ color: '#8A05BE', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                    🔗 {item.code}
                  </a>
                  {item.issueCode && (
                    <div style={{ fontSize: 11, marginTop: 2 }}>
                      <a href={item.issueLink} target="_blank" rel="noreferrer"
                        style={{ color: '#8A05BE99', textDecoration: 'none' }}>↑ {item.issueCode}</a>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 13, color: '#1A1A2E', flex: 1 }}>{item.summary}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ fontSize: 11, color: '#6B6B80', marginTop: 8, textAlign: 'right' }}>
        Click a count to see items · Click a row to filter charts
      </div>
    </div>
  )
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export default function OverviewTab({ issues, aps }) {
  const [selectedStatus, setSelectedStatus] = useState(null)
  const [selectedBA,     setSelectedBA]     = useState(null)

  // Cross-filtered datasets
  const filteredIssues = issues
    .filter(i => !selectedStatus || i.status === selectedStatus)
    .filter(i => !selectedBA     || normalizeBA(i['Business Area']) === selectedBA)
  const filteredAPs = aps.filter(a => !selectedBA || normalizeBA(a['Business Area']) === selectedBA)

  // KPI counts (BA-filtered only, not status-filtered, for totals)
  const issuesBA   = issues.filter(i => !selectedBA || normalizeBA(i['Business Area']) === selectedBA)
  const issuesOnly = issuesBA.filter(i => i.Type === 'Issue')
  const potIssues  = issuesBA.filter(i => i.Type === 'Potential Issue')

  // BA chart data builders. When splitByType, each status becomes two stacked
  // keys ("<status>_c" confirmed, "<status>_p" potential) so the bar chart can
  // render the same solid/striped language as the Risk Rating card.
  const buildBAData = (rows, statusFn, splitByType = false) => {
    const map = {}
    rows.forEach(r => {
      const ba = normalizeBA(r['Business Area'] || 'Unknown')
      if (!map[ba]) map[ba] = { ba, total: 0 }
      const status = statusFn(r)
      const key = splitByType ? `${status}_${r.Type === 'Potential Issue' ? 'p' : 'c'}` : status
      map[ba][key] = (map[ba][key] || 0) + 1
      map[ba].total++
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
  }
  const issueStatus = i => i.status === 'Late' ? 'Late' : i.status === 'TBD' ? 'TBD' : i.status === 'In Validation' ? 'In Validation' : 'On Track'
  const apStatus    = a => a.ap_status === 'Late' ? 'Late' : ['Pending Approval','Pending Approval (late)','Pending Validation','Pending Validation (late)','In Validation'].includes(a.ap_status) ? 'Pending' : 'On Track'

  // BA charts respond to status filter (but not BA filter — that's the axis itself)
  const issuesForCharts = issues.filter(i => !selectedStatus || i.status === selectedStatus)
  const apsForCharts    = aps.filter(a => !selectedStatus || a.ap_status === selectedStatus)

  // Confirmed Issues + Potential Issues combined into one chart (split by type per status)
  const baIssuesData  = buildBAData(issuesForCharts, issueStatus, true)
  const baAPsData     = buildBAData(apsForCharts,    apStatus)

  // Rating (cross-filtered) — split confirmed Issues vs Potential Issues so a
  // scary rating (e.g. 1 Very High) doesn't alarm when it's only a potential issue
  const ratingData = RATINGS_ORDER.map(name => {
    const color = RATING_COLORS[name]
    const rows = filteredIssues.filter(i => i.overall_risk_rating === name)
    return {
      name, color,
      value:     rows.length,
      confirmed: rows.filter(i => i.Type === 'Issue').length,
      potential: rows.filter(i => i.Type === 'Potential Issue').length,
    }
  })

  // Origin x Risk Rating (cross-filtered) — each origin becomes a stacked bar with
  // one solid/striped pair per rating, same visual language as the BA chart.
  const originData = (() => {
    const map = {}
    filteredIssues.forEach(r => {
      const origin = (r.origin || '').trim() || 'Unknown'
      if (!map[origin]) map[origin] = { origin, total: 0 }
      const rating = RATINGS_ORDER.includes(r.overall_risk_rating) ? r.overall_risk_rating : 'Low'
      const key = `${rating}_${r.Type === 'Potential Issue' ? 'p' : 'c'}`
      map[origin][key] = (map[origin][key] || 0) + 1
      map[origin].total++
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
  })()

  // Subcategory x Origin (cross-filtered) — correlates with the Origin & Risk Rating chart
  // above instead of repeating Risk Rating (subcategory maps almost 1:1 to an origin, so
  // pairing it with Origin surfaces new information instead of duplicating the rating split).
  const subcategoryData = (() => {
    const map = {}
    filteredIssues.forEach(r => {
      const subcategory = (r.subcategory || '').trim() || 'Unknown'
      if (!map[subcategory]) map[subcategory] = { subcategory, total: 0 }
      const origin = ORIGINS_ORDER.includes((r.origin || '').trim()) ? r.origin.trim() : 'Unknown'
      const key = `${origin}_${r.Type === 'Potential Issue' ? 'p' : 'c'}`
      map[subcategory][key] = (map[subcategory][key] || 0) + 1
      map[subcategory].total++
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
  })()

  const [chartDrilldown, setChartDrilldown] = useState(null) // { ba, type, items }

  const handleBAClick = useCallback((data, chartType) => {
    if (!data?.activePayload?.[0]?.payload?.ba) return
    const ba = data.activePayload[0].payload.ba
    setSelectedBA(prev => prev === ba ? null : ba)

    // Build drilldown items
    let rows
    if (chartType === 'Issue') {
      rows = issues
        .filter(i => normalizeBA(i['Business Area']) === ba)
        .map(i => ({ code: i.code, summary: i.summary, link: i.projac_link, status: i.status, rating: i.overall_risk_rating, type: i.Type, dueDate: i.due_date_at, npf: i['NP&F+'] }))
    } else {
      rows = aps
        .filter(a => normalizeBA(a['Business Area']) === ba)
        .map(a => ({ code: a.ap_code, summary: a.ap_summary, link: a.ap_link_projac, status: a.ap_status, issueCode: a['Issue Code'], issueLink: a.issue_link_projac, dueDate: a.ap_due_date_at }))
    }

    setChartDrilldown(prev =>
      prev?.ba === ba && prev?.type === chartType ? null : { ba, type: chartType, items: rows }
    )
  }, [issues, aps])

  const handleRatingClick = useCallback((rating, color) => {
    const rows = filteredIssues
      .filter(i => i.overall_risk_rating === rating)
      .map(i => ({ code: i.code, summary: i.summary, link: i.projac_link, status: i.status, rating: i.overall_risk_rating, type: i.Type, dueDate: i.due_date_at, npf: i['NP&F+'] }))
    setChartDrilldown(prev =>
      prev?.rating === rating ? null : { rating, title: `${rating} — Risk Rating`, titleColor: color, items: rows }
    )
  }, [filteredIssues])

  const handleOriginClick = useCallback((data) => {
    const origin = data?.activePayload?.[0]?.payload?.origin
    if (!origin) return
    const rows = filteredIssues
      .filter(i => ((i.origin || '').trim() || 'Unknown') === origin)
      .map(i => ({ code: i.code, summary: i.summary, link: i.projac_link, status: i.status, rating: i.overall_risk_rating, type: i.Type, dueDate: i.due_date_at, npf: i['NP&F+'] }))
    setChartDrilldown(prev =>
      prev?.origin === origin ? null : { origin, title: `${origin} — Origin`, items: rows }
    )
  }, [filteredIssues])

  const handleSubcategoryClick = useCallback((data) => {
    const subcategory = data?.activePayload?.[0]?.payload?.subcategory
    if (!subcategory) return
    const rows = filteredIssues
      .filter(i => ((i.subcategory || '').trim() || 'Unknown') === subcategory)
      .map(i => ({ code: i.code, summary: i.summary, link: i.projac_link, status: i.status, rating: i.overall_risk_rating, type: i.Type, dueDate: i.due_date_at, npf: i['NP&F+'] }))
    setChartDrilldown(prev =>
      prev?.subcategory === subcategory ? null : { subcategory, title: `${subcategory} — Subcategory`, items: rows }
    )
  }, [filteredIssues])

  const barOp = ba => (!selectedBA || selectedBA === ba) ? 1 : 0.3

  const BAYAxis = ({ selectedBA }) => ({
    type: 'category', dataKey: 'ba', width: 190, axisLine: false, tickLine: false, interval: 0,
    tick: props => <BAYTick {...props} selectedBA={selectedBA} />
  })

  const originGrandTotal = originData.reduce((s, d) => s + d.total, 0)

  const OriginYTick = ({ x, y, payload }) => {
    const row = originData.find(d => d.origin === payload.value)
    const pct = row && originGrandTotal ? Math.round((row.total / originGrandTotal) * 100) : 0
    return (
      <text x={x} y={y} dy={4} textAnchor="end" fontSize={12} fill="#1A1A2E">
        {payload.value}
        <tspan fill="#6B6B80" fontSize={10}> ({row?.total ?? 0} · {pct}%)</tspan>
      </text>
    )
  }

  const OriginYAxis = {
    type: 'category', dataKey: 'origin', width: 200, axisLine: false, tickLine: false, interval: 0,
    tick: OriginYTick
  }

  const subcategoryGrandTotal = subcategoryData.reduce((s, d) => s + d.total, 0)
  const subcategoryOrigins = ORIGINS_ORDER.filter(o =>
    subcategoryData.some(d => (d[`${o}_c`] || 0) + (d[`${o}_p`] || 0) > 0))

  const SubcategoryYTick = ({ x, y, payload }) => {
    const row = subcategoryData.find(d => d.subcategory === payload.value)
    const pct = row && subcategoryGrandTotal ? Math.round((row.total / subcategoryGrandTotal) * 100) : 0
    return (
      <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="#1A1A2E">
        {payload.value.length > 34 ? `${payload.value.slice(0, 33)}…` : payload.value}
        <tspan fill="#6B6B80" fontSize={10}> ({row?.total ?? 0} · {pct}%)</tspan>
      </text>
    )
  }

  const SubcategoryYAxis = {
    type: 'category', dataKey: 'subcategory', width: 280, axisLine: false, tickLine: false, interval: 0,
    tick: SubcategoryYTick
  }

  return (
    <div>
      {/* Active filter pills */}
      {(selectedStatus || selectedBA) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#6B6B80', fontWeight: 600 }}>Active filters:</span>
          {selectedStatus && <FilterPill label={`Status: ${selectedStatus}`} color={DONUT_COLORS[selectedStatus] || '#8A05BE'} onClear={() => setSelectedStatus(null)} />}
          {selectedBA     && <FilterPill label={`BA: ${selectedBA}`}         color="#8A05BE"                                    onClear={() => setSelectedBA(null)} />}
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 36 }}>
        <KPICard label="Issues"             total={issuesOnly.length}      late={issuesOnly.filter(i => i.status === 'Late').length}  color="#E0002A" icon="🔴" />
        <KPICard label="Potential Issues"   total={potIssues.length}       late={potIssues.filter(i => i.status === 'Late').length}   color="#D48000" icon="⚠️" />
        <KPICard label="Action Plans"       total={filteredAPs.length}     late={filteredAPs.filter(a => a.ap_status === 'Late').length} color="#8A05BE" icon="📋" />
        <KPICard label="Pending (Late)"     total={filteredAPs.filter(a => ['Pending Validation (late)','Pending Approval (late)'].includes(a.ap_status)).length + filteredAPs.filter(a => a.ap_status === 'Late').length}
          late={filteredAPs.filter(a => ['Pending Validation (late)','Pending Approval (late)'].includes(a.ap_status)).length} color="#D48000" icon="⏳" />
      </div>

      {/* Row 1: Issues by BA (confirmed solid + potential striped) | Status donut + Risk Rating */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, marginBottom: 16, alignItems: 'stretch' }}>
        <ChartCard title="Issues by Business Area" subtitle="Solid = issue · striped = potential · click a bar to filter" fill>
          <ResponsiveContainer width="100%" height={Math.max(200, baIssuesData.length * 34)}>
            <BarChart data={baIssuesData} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
              onClick={d => handleBAClick(d, 'Issue')} style={{ cursor: 'pointer' }}>
              <StripeDefs colors={Object.values(DONUT_COLORS)} />
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#6B6B80' }} axisLine={false} tickLine={false} />
              <YAxis {...BAYAxis({ selectedBA })} />
              <Tooltip contentStyle={tooltipStyle} content={<BATooltip />} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }}
                payload={Object.entries(DONUT_COLORS).map(([name, color]) => ({ value: name, type: 'rect', color }))} />
              <Bar dataKey="On Track_c"      stackId="a" fill={DONUT_COLORS['On Track']}      opacity={barOp} legendType="none" />
              <Bar dataKey="On Track_p"      stackId="a" fill={fillFor(DONUT_COLORS['On Track'], true)}      opacity={barOp} legendType="none" />
              <Bar dataKey="In Validation_c" stackId="a" fill={DONUT_COLORS['In Validation']} opacity={barOp} legendType="none" />
              <Bar dataKey="In Validation_p" stackId="a" fill={fillFor(DONUT_COLORS['In Validation'], true)} opacity={barOp} legendType="none" />
              <Bar dataKey="TBD_c"           stackId="a" fill={DONUT_COLORS['TBD']}           opacity={barOp} legendType="none" />
              <Bar dataKey="TBD_p"           stackId="a" fill={fillFor(DONUT_COLORS['TBD'], true)}           opacity={barOp} legendType="none" />
              <Bar dataKey="Late_c"          stackId="a" fill={DONUT_COLORS['Late']}          opacity={barOp} legendType="none" />
              <Bar dataKey="Late_p"          stackId="a" fill={fillFor(DONUT_COLORS['Late'], true)}          opacity={barOp} legendType="none" radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
          <IssueTypeLegend />
        </ChartCard>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <StatusDonut confirmedRows={issuesOnly} potentialRows={potIssues} selectedStatus={selectedStatus} onSelect={setSelectedStatus} />

        <ChartCard title="Issues by Risk Rating" subtitle="Filtered by active status & BA · Click a rating to see the issues"
          right={
            <span style={{ background: '#F0EDF5', color: '#1A1A2E', borderRadius: 20, padding: '4px 12px',
              fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
              {filteredIssues.length} total
            </span>
          }>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 0' }}>
            {ratingData.map(({ name, value, color, confirmed, potential }) => {
              const total = filteredIssues.length
              const pct          = total ? Math.round((value / total) * 100) : 0
              const confirmedPct = total ? (confirmed / total) * 100 : 0
              const potentialPct = total ? (potential / total) * 100 : 0
              const isOpen = chartDrilldown?.rating === name
              const disabled = value === 0
              const stripe = `repeating-linear-gradient(45deg, ${color} 0, ${color} 2px, #F0EDF5 2px, #F0EDF5 5px)`
              return (
                <button key={name} onClick={() => !disabled && handleRatingClick(name, color)}
                  disabled={disabled}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: isOpen ? color + '0D' : 'none',
                    border: isOpen ? `1.5px solid ${color}44` : '1.5px solid transparent', borderRadius: 8,
                    padding: '6px 8px', margin: '-6px -8px', cursor: disabled ? 'default' : 'pointer',
                    transition: 'all 0.15s', font: 'inherit' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13, marginBottom: 5, gap: 8 }}>
                    <span style={{ fontWeight: 600, color, textDecoration: disabled ? 'none' : 'underline dotted', textUnderlineOffset: 3 }}>{name}</span>
                    <span style={{ color: '#6B6B80', textAlign: 'right' }}>
                      {value} ({pct}%)
                      {potential > 0 && (
                        <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600 }}>
                          · <span style={{ color: '#1A6FCC' }}>{confirmed} issue{confirmed !== 1 ? 's' : ''} ({Math.round(confirmedPct)}%)</span>
                          {' + '}<span style={{ color: '#D48000' }}>{potential} pot. ({Math.round(potentialPct)}%)</span>
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={{ height: 10, background: '#F0EDF5', borderRadius: 5, overflow: 'hidden', display: 'flex' }}>
                    <div style={{ height: '100%', width: `${confirmedPct}%`, background: color, transition: 'width 0.6s ease' }} />
                    <div style={{ height: '100%', width: `${potentialPct}%`, backgroundImage: stripe, transition: 'width 0.6s ease' }} />
                  </div>
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 10.5, color: '#6B6B80', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 16, height: 8, borderRadius: 2, background: '#6B6B80', display: 'inline-block' }} /> Issue
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 16, height: 8, borderRadius: 2, display: 'inline-block',
                backgroundImage: 'repeating-linear-gradient(45deg, #6B6B80 0, #6B6B80 2px, #F0EDF5 2px, #F0EDF5 5px)' }} /> Potential issue
            </span>
          </div>
        </ChartCard>
        </div>
      </div>

      {/* Row 1.5: Issues by Origin, correlated with Risk Rating (same solid/striped language) */}
      <div style={{ marginBottom: 16 }}>
        <ChartCard title="Issues by Origin & Risk Rating" subtitle="Solid = issue · striped = potential · click a bar to see the issues"
          right={
            <span style={{ background: '#F0EDF5', color: '#1A1A2E', borderRadius: 20, padding: '4px 12px',
              fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
              {originGrandTotal} total
            </span>
          }>
          <ResponsiveContainer width="100%" height={Math.max(160, originData.length * 40)}>
            <BarChart data={originData} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
              onClick={handleOriginClick} style={{ cursor: 'pointer' }}>
              <StripeDefs colors={Object.values(RATING_COLORS)} />
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#6B6B80' }} axisLine={false} tickLine={false} />
              <YAxis {...OriginYAxis} />
              <Tooltip contentStyle={tooltipStyle} content={p => <BATooltip {...p} colorMap={RATING_COLORS} />} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }}
                payload={RATINGS_ORDER.map(name => ({ value: name, type: 'rect', color: RATING_COLORS[name] }))} />
              {RATINGS_ORDER.flatMap(name => [
                <Bar key={`${name}_c`} dataKey={`${name}_c`} stackId="a" fill={RATING_COLORS[name]} legendType="none" />,
                <Bar key={`${name}_p`} dataKey={`${name}_p`} stackId="a" fill={fillFor(RATING_COLORS[name], true)} legendType="none"
                  radius={name === 'Low' ? [0, 4, 4, 0] : undefined} />,
              ])}
            </BarChart>
          </ResponsiveContainer>
          <IssueTypeLegend />
        </ChartCard>
      </div>

      {/* Row 1.6: Issues by Subcategory, correlated with Origin (ties back into the Origin
          & Risk Rating chart above instead of repeating the rating split) */}
      <div style={{ marginBottom: 16 }}>
        <ChartCard title="Issues by Subcategory & Origin" subtitle="Solid = issue · striped = potential · click a bar to see the issues"
          right={
            <span style={{ background: '#F0EDF5', color: '#1A1A2E', borderRadius: 20, padding: '4px 12px',
              fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
              {subcategoryGrandTotal} total
            </span>
          }>
          <ResponsiveContainer width="100%" height={Math.max(160, subcategoryData.length * 40)}>
            <BarChart data={subcategoryData} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
              onClick={handleSubcategoryClick} style={{ cursor: 'pointer' }}>
              <StripeDefs colors={Object.values(ORIGIN_COLORS)} />
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#6B6B80' }} axisLine={false} tickLine={false} />
              <YAxis {...SubcategoryYAxis} />
              <Tooltip contentStyle={tooltipStyle} content={p => <BATooltip {...p} colorMap={ORIGIN_COLORS} />} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }}
                payload={subcategoryOrigins.map(name => ({ value: name, type: 'rect', color: ORIGIN_COLORS[name] }))} />
              {subcategoryOrigins.flatMap((name, i) => [
                <Bar key={`${name}_c`} dataKey={`${name}_c`} stackId="a" fill={ORIGIN_COLORS[name]} legendType="none" />,
                <Bar key={`${name}_p`} dataKey={`${name}_p`} stackId="a" fill={fillFor(ORIGIN_COLORS[name], true)} legendType="none"
                  radius={i === subcategoryOrigins.length - 1 ? [0, 4, 4, 0] : undefined} />,
              ])}
            </BarChart>
          </ResponsiveContainer>
          <IssueTypeLegend />
        </ChartCard>
      </div>

      {/* Row 2: Action Plans by BA */}
      <div style={{ marginBottom: 16 }}>
        <ChartCard title="Action Plans by Business Area" subtitle="Click a bar to filter and see items below">
          <ResponsiveContainer width="100%" height={Math.max(200, baAPsData.length * 34)}>
            <BarChart data={baAPsData} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
              onClick={d => handleBAClick(d, 'AP')} style={{ cursor: 'pointer' }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#6B6B80' }} axisLine={false} tickLine={false} />
              <YAxis {...BAYAxis({ selectedBA })} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="On Track" stackId="a" fill="#007A57" opacity={barOp} />
              <Bar dataKey="Pending"  stackId="a" fill="#D48000" opacity={barOp} />
              <Bar dataKey="Late"     stackId="a" fill="#E0002A" radius={[0,4,4,0]} opacity={barOp} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 4: Consolidated BA table */}
      <ChartCard title="Consolidated View by Business Area" subtitle="Click a count to drill down to individual items · Click a row to filter charts">
        <BATable issues={issues} aps={aps} selectedBA={selectedBA} onSelectBA={setSelectedBA} />
      </ChartCard>

      {/* Chart bar drilldown — appears at bottom when clicking a bar */}
      {chartDrilldown && (
        <div style={{ marginTop: 24, background: '#fff', borderRadius: 16, padding: '20px 24px',
          boxShadow: '0 1px 6px rgba(0,0,0,0.07)', border: '1.5px solid #8A05BE44' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: 15, fontWeight: 700, color: chartDrilldown.titleColor || '#1A1A2E' }}>
                {chartDrilldown.title
                  ? chartDrilldown.title
                  : `${chartDrilldown.type === 'AP' ? 'Action Plans' : chartDrilldown.type + 's'} — ${chartDrilldown.ba}`}
              </span>
              <span style={{ marginLeft: 10, fontSize: 12, color: '#6B6B80' }}>
                {chartDrilldown.items.length} item{chartDrilldown.items.length !== 1 ? 's' : ''}
              </span>
              {(chartDrilldown.rating || chartDrilldown.origin || chartDrilldown.subcategory) && (
                <span style={{ marginLeft: 8, fontSize: 12, color: '#6B6B80' }}>
                  · <b style={{ color: '#1A6FCC' }}>{chartDrilldown.items.filter(x => x.type === 'Issue').length}</b> issue
                  {' · '}<b style={{ color: '#D48000' }}>{chartDrilldown.items.filter(x => x.type === 'Potential Issue').length}</b> potential
                </span>
              )}
            </div>
            <button onClick={() => setChartDrilldown(null)} style={{ background: 'none', border: 'none',
              fontSize: 20, cursor: 'pointer', color: '#6B6B80', lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {chartDrilldown.items.length === 0
              ? <div style={{ color: '#6B6B80', fontSize: 13, textAlign: 'center', padding: 24 }}>No items found</div>
              : [...chartDrilldown.items].sort(byDueDate).map((item, i) => {
                  const STATUS_COLOR = { Late: '#E0002A', 'On Track': '#007A57', TBD: '#D48000', 'In Validation': '#1A6FCC' }
                  const RATING_COLOR = { 'Very High': '#9B0020', High: '#E0002A', Medium: '#D48000', Low: '#1A6FCC' }
                  const statusColor = STATUS_COLOR[item.status] || '#6B6B80'
                  return (
                    <div key={i} style={{ background: '#F8F7FB', borderRadius: 10, padding: '12px 16px',
                      border: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                      {/* Code + parent issue for APs */}
                      <div style={{ minWidth: 110 }}>
                        <a href={item.link} target="_blank" rel="noreferrer"
                          style={{ color: '#8A05BE', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                          🔗 {item.code}
                        </a>
                        {item.issueCode && (
                          <div style={{ fontSize: 11, marginTop: 3 }}>
                            <a href={item.issueLink} target="_blank" rel="noreferrer"
                              style={{ color: '#8A05BE99', textDecoration: 'none' }}>↑ {item.issueCode}</a>
                          </div>
                        )}
                      </div>
                      {/* Summary */}
                      <div style={{ flex: 1, fontSize: 13, color: '#1A1A2E', minWidth: 200 }}>{item.summary}</div>
                      {/* Badges */}
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {item.type && (() => {
                          const tColor = item.type === 'Potential Issue' ? '#D48000' : '#1A6FCC'
                          return (
                            <span style={{ background: tColor + '15', color: tColor,
                              border: `1px solid ${tColor}44`, borderRadius: 6,
                              padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                              {item.type === 'Potential Issue' ? '⚠️ Potential' : '🔴 Issue'}
                            </span>
                          )
                        })()}
                        {item.status && (
                          <span style={{ background: statusColor + '15', color: statusColor,
                            border: `1px solid ${statusColor}44`, borderRadius: 6,
                            padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{item.status}</span>
                        )}
                        {item.rating && (
                          <span style={{ background: (RATING_COLOR[item.rating] || '#888') + '15',
                            color: RATING_COLOR[item.rating] || '#888',
                            border: `1px solid ${(RATING_COLOR[item.rating] || '#888')}44`,
                            borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{item.rating}</span>
                        )}
                        {fmtDue(item.dueDate) && (() => {
                          const days = daysUntil(item.dueDate)
                          const overdue = item.status === 'Late' || (days !== null && days < 0)
                          const soon = !overdue && days !== null && days <= SOON_THRESHOLD_DAYS
                          const dColor = overdue ? '#E0002A' : soon ? '#D48000' : '#6B6B80'
                          const icon = overdue ? '⚠️' : soon ? '⏰' : '📅'
                          return (
                            <span style={{ background: dColor + '12', color: dColor,
                              border: `1px solid ${dColor}33`, borderRadius: 6,
                              padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                              {icon} Due {fmtDue(item.dueDate)}
                            </span>
                          )
                        })()}
                        {item.npf && item.npf !== '-' && (
                          <a href={item.npf} target="_blank" rel="noreferrer" title="NP&F+ assessment reference"
                            onClick={e => e.stopPropagation()}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                              background: '#FF6B0015', color: '#B84500', border: '1px solid #FF6B0044',
                              borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, textDecoration: 'none' }}>
                              🔗 {item.npf.split('/').pop() || 'NP&F+'}
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })
            }
          </div>
        </div>
      )}
    </div>
  )
}
