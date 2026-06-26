import { useMemo, useState } from 'react'
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
         ResponsiveContainer } from 'recharts'
import { IssueCard } from './LateIssues'

/* ─── BA normalization (mirrors Python BA_ALIASES / OverviewTab) ───────────── */
const BA_ALIASES = {
  'CPX': 'Common Product Experience',
  'Common product experience': 'Common Product Experience',
  'Unsecured Loans': 'Unsecured Lending',
  'Lending PJ': 'PJ Lending',
  'Lending Foundations': 'Lending Foundations Platforms',
}
const normalizeBA = ba => BA_ALIASES[ba] || ba || 'TBD'

/* Origins que contam como "self-identified" (def. oficial MOR KPI) */
const SELF_ORIGINS = new Set(['Self-Identified', 'Defense Assessment', 'Internal Audit'])

/* Paleta determinística por BA */
const BA_PALETTE = ['#8A05BE', '#1A6FCC', '#007A57', '#D48000', '#E0002A',
  '#7C3AED', '#0E9F9F', '#C2185B', '#5B7C00', '#B26A00', '#3949AB', '#00796B',
  '#9C27B0', '#F4511E']

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const fmtMonth = ym => {
  const [y, m] = ym.split('-')
  return `${MONTHS_PT[(+m) - 1]}/${y.slice(2)}`
}

const tooltipStyle = { background: '#fff', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8,
  fontSize: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }

const TYPE_OPTS = [
  { key: 'Ambos', label: 'Ambos' },
  { key: 'Issue', label: 'Issues' },
  { key: 'Potential Issue', label: 'Potential Issues' },
]

export default function TrendTab({ issues }) {
  const [typeFilter, setTypeFilter] = useState('Ambos')
  const [hiddenBAs, setHiddenBAs] = useState(() => new Set())
  const [selected, setSelected] = useState(null)   // { month, ba }

  /* Self-identified de Global Lending, mantendo os campos completos */
  const selfIssues = useMemo(() => issues.filter(r =>
    SELF_ORIGINS.has((r.origin || '').trim()) && r.created_at
  ).map(r => ({
    month: r.created_at.slice(0, 7),
    ba: normalizeBA((r['Business Area'] || '').trim()),
    type: (r.Type || '').trim() === 'Potential Issue' ? 'Potential Issue' : 'Issue',
    code: r.code,
    row: r,
  })), [issues])

  const bas = useMemo(() => [...new Set(selfIssues.map(d => d.ba))].sort(), [selfIssues])
  const baColor = useMemo(() => {
    const m = {}; bas.forEach((b, i) => { m[b] = BA_PALETTE[i % BA_PALETTE.length] }); return m
  }, [bas])

  const months = useMemo(() => {
    if (!selfIssues.length) return []
    const all = selfIssues.map(d => d.month).sort()
    const [minY, minM] = all[0].split('-').map(Number)
    const [maxY, maxM] = all[all.length - 1].split('-').map(Number)
    const out = []
    let y = minY, mo = minM
    while (y < maxY || (y === maxY && mo <= maxM)) {
      out.push(`${y}-${String(mo).padStart(2, '0')}`)
      mo++; if (mo > 12) { mo = 1; y++ }
    }
    return out
  }, [selfIssues])

  const matchesType = d => typeFilter === 'Ambos' || d.type === typeFilter

  const chartData = useMemo(() => {
    const base = Object.fromEntries(months.map(m => [m, Object.fromEntries(bas.map(b => [b, 0]))]))
    selfIssues.forEach(d => {
      if (!matchesType(d)) return
      if (base[d.month]) base[d.month][d.ba]++
    })
    return months.map(m => ({ month: m, total: bas.reduce((s, b) => s + base[m][b], 0), ...base[m] }))
  }, [months, bas, selfIssues, typeFilter])

  const totals = useMemo(() => {
    const t = { Issue: 0, 'Potential Issue': 0 }
    selfIssues.forEach(d => { t[d.type]++ })
    return t
  }, [selfIssues])

  /* Issues do segmento selecionado (respeita o toggle) */
  const drill = useMemo(() => {
    if (!selected) return []
    return selfIssues
      .filter(d => d.month === selected.month && d.ba === selected.ba && matchesType(d))
      .sort((a, b) => (a.type > b.type ? 1 : -1) || a.code.localeCompare(b.code))
  }, [selected, selfIssues, typeFilter])

  const toggleBA = ba => setHiddenBAs(prev => {
    const next = new Set(prev); next.has(ba) ? next.delete(ba) : next.add(ba); return next
  })

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const rows = payload.filter(p => p.value > 0).sort((a, b) => b.value - a.value)
    const total = rows.reduce((s, p) => s + p.value, 0)
    if (!total) return null
    return (
      <div style={{ ...tooltipStyle, padding: '8px 12px' }}>
        <div style={{ fontWeight: 700, color: '#1A1A2E', marginBottom: 6 }}>{fmtMonth(label)} · {total} total</div>
        {rows.map(p => (
          <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color }} />
            <span style={{ color: '#6B6B80', flex: 1 }}>{p.dataKey}</span>
            <span style={{ fontWeight: 700, color: '#1A1A2E' }}>{p.value}</span>
          </div>
        ))}
        <div style={{ fontSize: 10, color: '#8A05BE', marginTop: 6 }}>clique para ver os issues ↓</div>
      </div>
    )
  }

  if (!selfIssues.length) return (
    <div style={{ color: '#6B6B80', padding: 40, textAlign: 'center' }}>
      Nenhuma issue self-identified com data de criação encontrada.
    </div>
  )

  return (
    <div>
      {/* Resumo + toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1A1A2E' }}>Self-Identified Issues por mês</div>
          <div style={{ fontSize: 13, color: '#6B6B80', marginTop: 4 }}>
            {selfIssues.length} issues ativas · {totals.Issue} Issues · {totals['Potential Issue']} Potential ·
            {' '}{bas.length} Business Areas · origin: Self-Identified + Defense Assessment + Internal Audit
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {TYPE_OPTS.map(opt => {
            const active = typeFilter === opt.key
            return (
              <button key={opt.key} onClick={() => setTypeFilter(opt.key)}
                style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 14px', borderRadius: 20,
                  background: active ? '#8A05BE' : '#F5F5F8', color: active ? '#fff' : '#6B6B80',
                  border: active ? '1.5px solid #8A05BE' : '1.5px solid transparent', transition: 'all 0.15s' }}>
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Gráfico empilhado por BA */}
      <div style={{ background: '#fff', borderRadius: 16, padding: '20px 24px',
        boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
        <div style={{ fontSize: 11, color: '#6B6B80', marginBottom: 12 }}>
          Cada cor é uma Business Area · <b style={{ color: '#8A05BE' }}>clique numa barra para ver os issues</b> · clique na legenda para ocultar/mostrar
        </div>
        <ResponsiveContainer width="100%" height={420}>
          <BarChart data={chartData} margin={{ left: 4, right: 16, top: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEE" />
            <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fontSize: 11, fill: '#6B6B80' }}
              interval={0} angle={-35} textAnchor="end" height={50} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B6B80' }} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#8A05BE0A' }} />
            <Legend onClick={e => toggleBA(e.dataKey)} wrapperStyle={{ fontSize: 11, cursor: 'pointer', paddingTop: 8 }} />
            {bas.map(ba => (
              <Bar key={ba} dataKey={ba} stackId="ba" hide={hiddenBAs.has(ba)} maxBarSize={48}
                cursor="pointer"
                onClick={(entry) => setSelected(
                  selected && selected.month === entry.month && selected.ba === ba
                    ? null : { month: entry.month, ba }
                )}>
                {chartData.map(d => {
                  const isSel = selected && selected.month === d.month && selected.ba === ba
                  const dim = selected && !isSel
                  return (
                    <Cell key={d.month} fill={baColor[ba]} fillOpacity={dim ? 0.28 : 1}
                      stroke={isSel ? '#1A1A2E' : 'none'} strokeWidth={1.5} />
                  )
                })}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Painel de drill-down */}
      {selected && (
        <div style={{ background: '#fff', borderRadius: 16, padding: '20px 24px', marginTop: 16,
          boxShadow: '0 1px 6px rgba(0,0,0,0.07)', borderTop: `4px solid ${baColor[selected.ba] || '#8A05BE'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#1A1A2E' }}>
                {fmtMonth(selected.month)} · {selected.ba}
              </div>
              <div style={{ fontSize: 12, color: '#6B6B80', marginTop: 2 }}>
                {drill.length} {drill.length === 1 ? 'issue' : 'issues'}
                {typeFilter !== 'Ambos' && ` · ${TYPE_OPTS.find(o => o.key === typeFilter).label}`}
              </div>
            </div>
            <button onClick={() => setSelected(null)} style={{ background: '#F5F5F8', border: 'none',
              borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, color: '#6B6B80', cursor: 'pointer' }}>
              ✕ fechar
            </button>
          </div>

          {drill.length === 0
            ? <div style={{ color: '#6B6B80', fontSize: 13 }}>Nenhum issue desse tipo nesse segmento.</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {drill.map(d => (
                  <IssueCard key={d.code} issue={d.row}
                    borderColor={d.type === 'Potential Issue' ? '#D48000' : '#1A6FCC'} />
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  )
}
