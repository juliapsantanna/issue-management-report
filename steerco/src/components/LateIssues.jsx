import { useState, useEffect } from 'react'

const RATING_COLOR = { 'Very High': '#9B0020', High: '#E0002A', Medium: '#D48000', Low: '#1A6FCC' }

function Badge({ text, color }) {
  if (!text) return null
  return (
    <span style={{
      background: color + '15', color, border: `1px solid ${color}44`,
      borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 600,
    }}>{text}</span>
  )
}

function PresentationNotes({ noteKey }) {
  const storageKey = `presentation-note-${noteKey}`
  const [note, setNote]       = useState(() => localStorage.getItem(storageKey) || '')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(note)

  const save = () => {
    localStorage.setItem(storageKey, draft)
    setNote(draft)
    setEditing(false)
  }

  if (editing) return (
    <div style={{ marginTop: 10 }}>
      <textarea
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder="Add presentation notes…"
        rows={3}
        style={{ width: '100%', fontSize: 12, borderRadius: 6, border: '1.5px solid #8A05BE66',
          padding: '8px 10px', resize: 'vertical', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={save} style={{ fontSize: 12, padding: '3px 12px', borderRadius: 6,
          background: '#8A05BE', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
          Save
        </button>
        <button onClick={() => { setDraft(note); setEditing(false) }}
          style={{ fontSize: 12, padding: '3px 12px', borderRadius: 6,
            background: '#F0EDF5', color: '#6B6B80', border: 'none', cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
      {note ? (
        <div style={{ flex: 1, background: '#FFF9E6', border: '1px solid #F0D060', borderRadius: 7,
          padding: '7px 10px', fontSize: 12, color: '#5A4700', lineHeight: 1.5 }}>
          📝 {note}
        </div>
      ) : (
        <span style={{ fontSize: 11, color: '#AAA', fontStyle: 'italic' }}>No presentation notes</span>
      )}
      <button onClick={() => { setDraft(note); setEditing(true) }}
        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5,
          background: '#F0EDF5', color: '#8A05BE', border: '1px solid #8A05BE33',
          cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 600 }}>
        ✏️ {note ? 'Edit' : 'Add note'}
      </button>
    </div>
  )
}

export function IssueCard({ issue, borderColor }) {
  const npfKey = issue['NP&F+'] && issue['NP&F+'] !== '-' ? issue['NP&F+'] : null

  return (
    <div style={{
      background: '#fff', border: `1px solid ${borderColor}33`,
      borderLeft: `4px solid ${borderColor}`, borderRadius: 12,
      padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
    }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: codes */}
        <div style={{ minWidth: 130 }}>
          <a href={issue.projac_link} target="_blank" rel="noreferrer"
            style={{ color: '#8A05BE', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
            {issue.code}
          </a>
          {npfKey && (
            <a href={npfKey} target="_blank" rel="noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6,
              background: '#FF6B0015', color: '#B84500', border: '1px solid #FF6B0044',
              borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, textDecoration: 'none',
            }}>
              🔗 {issue.key || 'NP&F+ Jira'}
            </a>
          )}
        </div>

        {/* Center: summary + badges + notes */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: '#1A1A2E' }}>{issue.summary}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
            <Badge text={issue.overall_risk_rating} color={RATING_COLOR[issue.overall_risk_rating] || '#888'} />
            <Badge text={issue['Business Area'] || 'N/A'} color="#1A6FCC" />
            <Badge text={issue.countries?.replace(/[\[\]"]/g, '') || ''} color="#6B6B80" />
          </div>
          <PresentationNotes noteKey={issue.code} />
        </div>

        {/* Right: action owner + due */}
        <div style={{ textAlign: 'right', minWidth: 130 }}>
          <div style={{ fontSize: 11, color: '#6B6B80' }}>Action Owner</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#D48000' }}>{issue['Action Owner'] || '—'}</div>
          <div style={{ fontSize: 11, color: '#6B6B80', marginTop: 4 }}>Due: {issue.due_date_at?.slice(0,10) || '—'}</div>
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ icon, label, count, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1A1A2E' }}>{label}</h2>
      <span style={{ background: color + '15', color, border: `1px solid ${color}44`,
        borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>{count}</span>
    </div>
  )
}

export default function LateIssues({ issues }) {
  if (!issues.length) return (
    <section style={{ marginBottom: 40 }}>
      <SectionTitle icon="✅" label="Late Issues" count={0} color="#007A57" />
      <div style={{ background: '#fff', borderRadius: 12, padding: 32, textAlign: 'center',
        color: '#6B6B80', border: '1px solid #E0F5EE' }}>No late issues 🎉</div>
    </section>
  )
  return (
    <section style={{ marginBottom: 40 }}>
      <SectionTitle icon="🔴" label="Late Issues" count={issues.length} color="#E0002A" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {issues.map(i => <IssueCard key={i.code} issue={i} borderColor="#E0002A" />)}
      </div>
    </section>
  )
}

export function LatePotentialIssues({ issues }) {
  if (!issues.length) return (
    <section style={{ marginBottom: 40 }}>
      <SectionTitle icon="✅" label="Late Potential Issues" count={0} color="#007A57" />
      <div style={{ background: '#fff', borderRadius: 12, padding: 32, textAlign: 'center',
        color: '#6B6B80', border: '1px solid #E0F5EE' }}>No late potential issues 🎉</div>
    </section>
  )
  return (
    <section style={{ marginBottom: 40 }}>
      <SectionTitle icon="⚠️" label="Late Potential Issues" count={issues.length} color="#D48000" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {issues.map(i => <IssueCard key={i.code} issue={i} borderColor="#D48000" />)}
      </div>
    </section>
  )
}
