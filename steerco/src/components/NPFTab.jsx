import { useMemo, useState } from 'react'

const RATING_COLOR = { 'Very High': '#9B0020', High: '#E0002A', Medium: '#D48000', Low: '#1A6FCC' }
const ORIGIN_COLOR  = { 'Self-Identified': '#007A57', 'Defense Assessment': '#8A05BE' }

const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const fmtMonth = ym => {
  const [y, m] = ym.split('-')
  return `${MONTHS_EN[(+m) - 1]}/${y.slice(2)}`
}

function Badge({ text, color }) {
  if (!text) return null
  return (
    <span style={{
      background: color + '15', color, border: `1px solid ${color}44`,
      borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
    }}>{text}</span>
  )
}

export default function NPFTab({ issues }) {
  const [openCats, setOpenCats] = useState(() => new Set())

  /* NP&F+ potential issues = has an NP&F+ (PNPF) reference linked.
     "name" = the NP&F+ item's own summary (there's no separate product/feature
     name field in Projac — the summary IS what identifies the NP&F+ item). */
  const npfIssues = useMemo(() => issues.filter(r =>
    r['NP&F+'] && r['NP&F+'] !== '-' && r.created_at
  ).map(r => ({
    name: r.summary || '(no summary)',
    month: r.created_at.slice(0, 7),
    ba: r['Business Area'] || 'TBD',
    origin: (r.origin || '').trim(),
    rating: r.overall_risk_rating || '',
    riskL1: r['Risk L1'] || '',
    riskL2: r['Risk L2'] || '',
    row: r,
  })), [issues])

  /* Group by Risk (L2) — the recurring category is the signal: the same L2
     category showing up across multiple NP&F+ launches means the same control
     gap keeps getting caught late, and is a candidate for a proactive
     (pre-launch) initiative instead of a per-launch fix. */
  const categories = useMemo(() => {
    const map = {}
    npfIssues.forEach(d => {
      const cat = d.riskL2 || 'Uncategorized'
      if (!map[cat]) map[cat] = []
      map[cat].push(d)
    })
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length)
  }, [npfIssues])

  const toggleCat = c => setOpenCats(prev => {
    const next = new Set(prev); next.has(c) ? next.delete(c) : next.add(c); return next
  })

  const selfCount    = npfIssues.filter(d => d.origin === 'Self-Identified').length
  const defenseCount = npfIssues.filter(d => d.origin !== 'Self-Identified').length

  if (!npfIssues.length) return (
    <div style={{ color: '#6B6B80', padding: 40, textAlign: 'center' }}>
      No NP&F+ potential issue with a creation date was found.
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1A1A2E' }}>NP&F+ — by Risk Category (L2)</div>
          <div style={{ fontSize: 13, color: '#6B6B80', marginTop: 4 }}>
            {npfIssues.length} potential issues · {selfCount} Self-Identified · {defenseCount} Defense Assessment ·
            {' '}{categories.length} risk categories
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {categories.map(([cat, rows]) => {
          const open = openCats.has(cat)
          const catSelf = rows.filter(d => d.origin === 'Self-Identified').length
          return (
            <div key={cat} style={{ background: '#fff', borderRadius: 16,
              boxShadow: '0 1px 6px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
              <button onClick={() => toggleCat(cat)} style={{
                width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, color: '#8A05BE', width: 14 }}>{open ? '▾' : '▸'}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#1A1A2E' }}>{cat}</span>
                  <Badge text={`${rows.length} potential issue${rows.length !== 1 ? 's' : ''}`} color="#8A05BE" />
                  <Badge text={`${catSelf} self · ${rows.length - catSelf} defense`} color="#6B6B80" />
                </div>
              </button>

              {open && (
                <div style={{ padding: '0 24px 20px', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ color: '#6B6B80', textAlign: 'left', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                        <th style={{ padding: '6px 8px' }}>Code</th>
                        <th style={{ padding: '6px 8px' }}>NP&F+ Name</th>
                        <th style={{ padding: '6px 8px' }}>Business Area</th>
                        <th style={{ padding: '6px 8px' }}>Origin</th>
                        <th style={{ padding: '6px 8px' }}>Rating</th>
                        <th style={{ padding: '6px 8px' }}>Opened</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(d => (
                        <tr key={d.row.code} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                          <td style={{ padding: '8px' }}>
                            <a href={d.row.projac_link} target="_blank" rel="noreferrer"
                              style={{ color: '#8A05BE', fontWeight: 700, textDecoration: 'none' }}>
                              {d.row.code}
                            </a>
                          </td>
                          <td style={{ padding: '8px', fontWeight: 600, color: '#1A1A2E' }}>{d.name}</td>
                          <td style={{ padding: '8px', color: '#1A1A2E' }}>{d.ba}</td>
                          <td style={{ padding: '8px' }}>
                            <Badge text={d.origin === 'Self-Identified' ? 'Self-Identified' : 'Defense Assessment'}
                              color={ORIGIN_COLOR[d.origin] || '#6B6B80'} />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <Badge text={d.rating || '—'} color={RATING_COLOR[d.rating] || '#888'} />
                          </td>
                          <td style={{ padding: '8px', color: '#6B6B80' }}>{fmtMonth(d.month)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
