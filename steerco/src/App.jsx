import { useState, useEffect } from 'react'
import Header from './components/Header'
import OverviewTab from './components/OverviewTab'
import DetailsTab from './components/DetailsTab'
import TrendTab from './components/TrendTab'
import NPFTab from './components/NPFTab'

function parseCSV(text) {
  if (!text?.trim()) return []
  const lines = text.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim())
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
    const row = {}
    headers.forEach((h, i) => {
      let v = (vals[i] || '').trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      row[h] = v
    })
    return row
  })
}

const TAB_STYLE = (active) => ({
  padding: '10px 24px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  background: 'none',
  borderBottom: active ? '3px solid #8A05BE' : '3px solid transparent',
  color: active ? '#8A05BE' : '#6B6B80',
  transition: 'all 0.15s',
})

export default function App() {
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('overview')

  useEffect(() => {
    fetch(import.meta.env.BASE_URL + 'data.json')
      .then(r => r.json())
      .then(setData)
      .catch(() => setData({ error: 'data.json not found — run generate_report.py first' }))
  }, [])

  if (!data) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ width:40, height:40, border:'3px solid #8A05BE', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 12px' }} />
        <p style={{ color:'#6B6B80', fontSize:14 }}>Loading…</p>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (data.error) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'#E0002A' }}>{data.error}</div>
  )

  const issues = parseCSV(data.issues_csv)
  const aps    = parseCSV(data.aps_csv)

  return (
    <div style={{ maxWidth:1280, margin:'0 auto', padding:'0 24px 64px' }}>
      <Header generatedAt={data.generated_at} />

      {/* Tabs */}
      <div style={{ borderBottom:'1px solid rgba(0,0,0,0.08)', marginBottom:32, display:'flex', gap:4 }}>
        <button style={TAB_STYLE(tab==='overview')} onClick={() => setTab('overview')}>
          📊 Dashboard
        </button>
        <button style={TAB_STYLE(tab==='details')} onClick={() => setTab('details')}>
          📋 Detail
        </button>
        <button style={TAB_STYLE(tab==='trend')} onClick={() => setTab('trend')}>
          📈 Self-Identified
        </button>
        <button style={TAB_STYLE(tab==='npf')} onClick={() => setTab('npf')}>
          🧭 NP&F+
        </button>
      </div>

      {tab === 'overview' && <OverviewTab issues={issues} aps={aps} />}
      {tab === 'details'  && <DetailsTab  issues={issues} aps={aps} />}
      {tab === 'trend'    && <TrendTab    issues={issues} />}
      {tab === 'npf'      && <NPFTab      issues={issues} />}
    </div>
  )
}
