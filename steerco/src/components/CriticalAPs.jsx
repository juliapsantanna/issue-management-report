import { useState } from 'react'

const STATUS_META = {
  'Late':                      { color: '#E0002A', label: 'Late',                      icon: '🔴' },
  'Pending Validation (late)': { color: '#D48000', label: 'Pending Validation (late)', icon: '⏳' },
  'Pending Approval (late)':   { color: '#D48000', label: 'Pending Approval (late)',   icon: '⏳' },
  'Pending Validation':        { color: '#1A6FCC', label: 'Pending Validation',        icon: '🔵' },
  'Pending Approval':          { color: '#1A6FCC', label: 'Pending Approval',          icon: '🔵' },
}

// Margin (in days) between the parent issue's max due date and this AP's own
// due date: positive = AP finishes before the issue's deadline (buffer),
// negative = AP is planned to finish after it (no margin).
function dueDateMargin(issueDue, apDue) {
  if (!issueDue || !apDue) return null
  const a = new Date(`${issueDue}T00:00:00`)
  const b = new Date(`${apDue}T00:00:00`)
  if (isNaN(a) || isNaN(b)) return null
  return Math.round((a - b) / 86400000)
}

function DueDateMargin({ ap }) {
  const issueDue = ap.issue_due_date_at?.slice(0, 10)
  const apDue    = ap.ap_due_date_at?.slice(0, 10)
  const margin   = dueDateMargin(issueDue, apDue)
  if (margin === null) return null

  const overrun = margin < 0
  const color   = overrun ? '#9B0020' : '#6B6B80'
  const text    = overrun
    ? `⚠️ ${Math.abs(margin)}d past issue's max due date (no margin)`
    : `${margin}d margin before issue's max due date`

  return (
    <div style={{ fontSize: 11, color, marginTop: 4, fontWeight: overrun ? 700 : 400 }}>{text}</div>
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
    <div style={{ marginTop: 8 }}>
      <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)}
        placeholder="Add presentation notes…" rows={2}
        style={{ width: '100%', fontSize: 12, borderRadius: 6, border: '1.5px solid #8A05BE66',
          padding: '6px 10px', resize: 'vertical', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={save} style={{ fontSize: 11, padding: '2px 10px', borderRadius: 5,
          background: '#8A05BE', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Save</button>
        <button onClick={() => { setDraft(note); setEditing(false) }}
          style={{ fontSize: 11, padding: '2px 10px', borderRadius: 5,
            background: '#F0EDF5', color: '#6B6B80', border: 'none', cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  )

  return (
    <div style={{ marginTop: 6, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
      {note
        ? <div style={{ flex: 1, background: '#FFF9E6', border: '1px solid #F0D060', borderRadius: 6,
            padding: '5px 9px', fontSize: 11, color: '#5A4700' }}>📝 {note}</div>
        : <span style={{ fontSize: 11, color: '#CCC', fontStyle: 'italic' }}>No presentation notes</span>
      }
      <button onClick={() => { setDraft(note); setEditing(true) }}
        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5,
          background: '#F0EDF5', color: '#8A05BE', border: '1px solid #8A05BE33',
          cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 600 }}>
        ✏️ {note ? 'Edit' : 'Add note'}
      </button>
    </div>
  )
}

function APCard({ ap }) {
  const meta = STATUS_META[ap.ap_status] || { color: '#888', label: ap.ap_status, icon: '⚪' }
  return (
    <div style={{ background: '#fff', border: `1px solid ${meta.color}33`, borderLeft: `4px solid ${meta.color}`,
      borderRadius: 12, padding: '14px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: AP code + parent issue code */}
        <div style={{ minWidth: 110 }}>
          <a href={ap.ap_link_projac} target="_blank" rel="noreferrer"
            style={{ color: '#8A05BE', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
            {ap.ap_code}
          </a>
          <div style={{ fontSize: 11, color: '#6B6B80', marginTop: 2 }}>
            <a href={ap.issue_link_projac} target="_blank" rel="noreferrer"
              style={{ color: '#8A05BE99', textDecoration: 'none' }}>
              ↑ {ap['Issue Code']}
            </a>
          </div>
        </div>

        {/* Center: summaries + badges */}
        <div style={{ flex: 1, minWidth: 160 }}>
          {/* Parent issue summary */}
          {ap.issue_summary && (
            <div style={{ fontSize: 11, color: '#6B6B80', marginBottom: 4, fontStyle: 'italic' }}>
              Issue: {ap.issue_summary}
            </div>
          )}
          {/* AP summary */}
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#1A1A2E' }}>{ap.ap_summary}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ background: meta.color + '15', color: meta.color, border: `1px solid ${meta.color}44`,
              borderRadius: 6, padding: '1px 8px', fontSize: 11, fontWeight: 600 }}>{meta.icon} {meta.label}</span>
            {ap['Business Area'] && (
              <span style={{ background: '#1A6FCC15', color: '#1A6FCC', border: '1px solid #1A6FCC44',
                borderRadius: 6, padding: '1px 8px', fontSize: 11, fontWeight: 600 }}>{ap['Business Area']}</span>
            )}
          </div>
          <PresentationNotes noteKey={ap.ap_code} />
        </div>

        {/* Right: owner + due */}
        <div style={{ textAlign: 'right', minWidth: 110 }}>
          <div style={{ fontSize: 11, color: '#6B6B80' }}>Action Owner</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#D48000' }}>{ap['Action Owner'] || '—'}</div>
          <div style={{ fontSize: 11, color: '#6B6B80', marginTop: 4 }}>Due: {ap.ap_due_date_at?.slice(0,10) || '—'}</div>
          <DueDateMargin ap={ap} />
        </div>
      </div>
    </div>
  )
}

function Group({ title, icon, items, color }) {
  if (!items.length) return null
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color }}>{title}</span>
        <span style={{ background: color + '15', color, border: `1px solid ${color}44`,
          borderRadius: 20, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>{items.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map(ap => <APCard key={ap.ap_code} ap={ap} />)}
      </div>
    </div>
  )
}

export default function CriticalAPs({ lateAPs, pendingValLate, pendingApprLate, pendingVal, pendingAppr }) {
  const total = lateAPs.length + pendingValLate.length + pendingApprLate.length + pendingVal.length + pendingAppr.length
  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 18 }}>⚠️</span>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1A1A2E' }}>Action Plans — Attention Required</h2>
        <span style={{ background: '#D4800015', color: '#D48000', border: '1px solid #D4800044',
          borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>{total}</span>
      </div>
      {total === 0
        ? <div style={{ background: '#fff', borderRadius: 12, padding: 32, textAlign: 'center',
            color: '#6B6B80', border: '1px solid #E0F5EE' }}>All action plans on track 🎉</div>
        : <>
            <Group title="Late"                      icon="🔴" items={lateAPs}         color="#E0002A" />
            <Group title="Pending Validation (late)" icon="⏳" items={pendingValLate}  color="#D48000" />
            <Group title="Pending Approval (late)"   icon="⏳" items={pendingApprLate} color="#D48000" />
            <Group title="Pending Validation"        icon="🔵" items={pendingVal}      color="#1A6FCC" />
            <Group title="Pending Approval"          icon="🔵" items={pendingAppr}     color="#1A6FCC" />
          </>
      }
    </section>
  )
}
