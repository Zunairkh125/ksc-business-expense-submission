// Attendance & Call-Out Log: simple log page, records dashboard with a bar chart, and the occurrence form.
import { useEffect, useMemo, useState } from 'react'
import { zoneFor, todayIn, abbrOn, nowIn, prettyDate, minutesLateBetween } from './zones.js'
import { attendanceApi } from './attendanceApi.js'
import {
  calculatePoints, priorMissedCountFrom, rollingTotal, thresholdBand, LOCATIONS, OCCURRENCE_TYPES,
  SHIFTS, NOTICE_OPTIONS, YES_NO, MISSED_TYPES,
} from '../../lib/attendance/points.js'
import './attendance.css'

const EMPTY = {
  employee_search: '', employee_key: '', employee_name: '', location: '', occurrence_type: '',
  sched_date: '', sched_time: '', arrival_date: '', arrival_time: '',
  minutes_late: '', occurrence_date: '', notification_time: '', shift_affected: '',
  protected: 'NO', sick_vacation: 'NO', notice_given: '', reason: '',
  kiosk_closed_due_to_delay: '', management_notified_before_shift: '',
}
const REQUIRED = [
  ['employee_key', 'Employee Name'], ['location', 'Location'], ['occurrence_type', 'Type of Occurrence'],
  ['sched_date', 'Scheduled shift date'], ['sched_time', 'Scheduled shift time'], ['occurrence_date', 'Date of Occurrence'],
  ['notification_time', 'Time of Notification'], ['shift_affected', 'Shift Affected'], ['protected', 'Protected'],
  ['sick_vacation', 'Sick/Vacation'], ['notice_given', 'Notice Given'], ['reason', 'Reason Provided'],
  ['kiosk_closed_due_to_delay', 'Was kiosk closed due to delay?'], ['management_notified_before_shift', 'Was management notified prior to shift start?'],
]
const BAND_ORDER = ['standard', 'verbal', 'written', 'review']

function formatTime12(value) {
  const [h, m] = String(value).split(':').map(Number)
  if (Number.isNaN(h)) return value
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${suffix}`
}
function fmtTime(date, time, zone) { return date && time ? `${date} ${formatTime12(time)} ${abbrOn(zone, date)}` : '' }

// Re-renders every 30 seconds so the "current time" hints stay correct.
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id) }, [])
  return now
}

export default function AttendanceApp({ session, onLogout }) {
  const [tab, setTab] = useState('log')
  const [me, setMe] = useState(null)
  const [employees, setEmployees] = useState([])
  const [slackUsers, setSlackUsers] = useState([])
  const [records, setRecords] = useState([])
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(''), 4200); return () => clearTimeout(t) }, [toast])

  async function load() {
    try {
      const [who, emp, rec, slk] = await Promise.all([
        attendanceApi('me', { token: session.token }),
        attendanceApi('employees', { token: session.token }),
        attendanceApi('records', { token: session.token }),
        attendanceApi('slack-users', { token: session.token }).catch(() => ({ users: [] })),
      ])
      setMe(who.me); setEmployees(emp.employees || []); setRecords(rec.records || []); setSlackUsers(slk.users || [])
    } catch (err) {
      setError(err.message)
      if (err.status === 401) onLogout()
    }
  }
  useEffect(() => { load() }, [])

  return <div className="att-shell">
    <header className="att-topbar">
      <div><strong>Kawaii HQ</strong> · Attendance & Call-Out</div>
      <div className="att-who">{me?.name || session.name} <span className="att-role">{me?.role || session.role}</span> <button className="att-link" onClick={onLogout}>Sign out</button></div>
    </header>
    <main className="att-main">
      {error && <div className="form-error">{error}</div>}
      <nav className="att-tabs">
        <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>Log Occurrence</button>
        <button className={tab === 'records' ? 'active' : ''} onClick={() => setTab('records')}>Records & Dashboard</button>
      </nav>
      {tab === 'log' && <LogPanel employees={employees} slackUsers={slackUsers} records={records} token={session.token}
        submittedBy={me?.name || session.name} submittedRole={me?.role || session.role}
        onSaved={(msg) => { setToast(msg); load() }} />}
      {tab === 'records' && <RecordsPanel records={records} canOverride={!!me?.canOverride} token={session.token}
        onChanged={(msg) => { setToast(msg); load() }} />}
    </main>
    {toast && <div className="toast">{toast}</div>}
  </div>
}

function LogPanel({ employees, slackUsers, records, token, submittedBy, submittedRole, onSaved }) {
  const [open, setOpen] = useState(false)
  const recent = [...records].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 6)
  return <div className="att-stack">
    <section className="att-hero">
      <div>
        <h2>Log an occurrence</h2>
        <p>Record a call-out, tardy, missed clock or no-show. Points are calculated automatically.</p>
      </div>
      <button className="att-new" onClick={() => setOpen(true)}>+ New occurrence</button>
    </section>

    <section className="att-card">
      <h3>Recently logged</h3>
      {recent.length === 0 && <p className="att-muted">No occurrences yet.</p>}
      {recent.map((r) => <div className="att-recent" key={r.id}>
        <div><strong>{r.employee_name}</strong> <span className="att-muted">· {r.occurrence_type}</span></div>
        <div className="att-muted">{r.occurrence_date} · {r.location || 'No location'}</div>
        <span className="att-points">{Number(r.points).toFixed(1)} pts</span>
      </div>)}
    </section>

    {open && <OccurrenceModal employees={employees} slackUsers={slackUsers} records={records} token={token} submittedBy={submittedBy} submittedRole={submittedRole}
      onClose={() => setOpen(false)} onSaved={(msg) => { setOpen(false); onSaved(msg) }} />}
  </div>
}

function OccurrenceModal({ employees, slackUsers, records, token, submittedBy, submittedRole, onClose, onSaved }) {
  const [f, setF] = useState({ ...EMPTY })
  const now = useNow()
  const zone = f.location ? zoneFor(f.location) : null
  const zoneDate = zone ? todayIn(zone, now) : ''
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key, value) => setF((prev) => ({ ...prev, [key]: value }))

  // Search covers every active Slack workspace user. Saved employees supply their default location.
  const [searchTerm, setSearchTerm] = useState('')
  const [searchHint, setSearchHint] = useState('')
  function runSearch() {
    const q = f.employee_search.trim()
    if (q.length < 3) { setSearchHint('Type at least 3 letters, then click Search.'); setSearchTerm(''); return }
    setSearchHint(''); setSearchTerm(q)
  }
  const matches = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (q.length < 3) return []
    return slackUsers.filter((u) => u.full_name.toLowerCase().includes(q)).slice(0, 8)
      .map((u) => ({ ...u, saved: employees.find((e) => e.slack_user_id === u.slack_user_id) }))
  }, [searchTerm, slackUsers, employees])
  const chosen = f.employee_key ? { full_name: f.employee_name, slack_user_id: f.employee_key } : null
  const savedId = f.employee_key ? (employees.find((e) => e.slack_user_id === f.employee_key)?.id || '') : ''
  const missing = REQUIRED.filter(([key]) => !String(f[key] || '').trim())
  const isMissed = MISSED_TYPES.includes(f.occurrence_type)

  // Live preview only. The server recalculates on submit and is the source of truth.
  const preview = useMemo(() => {
    if (!f.occurrence_type || !f.occurrence_date || !f.employee_key) return null
    const prior = savedId ? priorMissedCountFrom(records, savedId, f.occurrence_date) : 0
    const points = calculatePoints({
      type: f.occurrence_type, protected: f.protected, sickVacation: f.sick_vacation,
      noticeGiven: f.notice_given, minutesLate: f.minutes_late,
    }, prior)
    return { points, prior }
  }, [f, records, savedId])

  // Changing the location sets both dates to today in that location's own time zone.
  function chooseLocation(value) {
    const z = zoneFor(value)
    const today = todayIn(z, new Date())
    setF((p) => ({ ...p, location: value, occurrence_date: today, sched_date: today }))
  }

  // Minutes late = actual arrival minus scheduled start, both in the location's time zone (DST aware).
  // It fills in automatically when both times are entered, and stays editable.
  const autoLate = zone ? minutesLateBetween(zone, f.sched_date, f.sched_time, f.arrival_date, f.arrival_time) : null
  useEffect(() => {
    if (autoLate !== null) setF((p) => ({ ...p, minutes_late: String(autoLate) }))
  }, [autoLate])

  function pickEmployee(e) {
    setF((p) => ({ ...p, employee_key: e.slack_user_id, employee_name: e.full_name, employee_search: '' }))
    setSearchTerm(''); setSearchHint('')
    if (!f.location && e.saved?.location) chooseLocation(e.saved.location)
  }
  async function submit() {
    setSubmitted(true); setError('')
    if (missing.length) return
    setBusy(true)
    try {
      await attendanceApi('records', {
        method: 'POST', token,
        body: {
          employee_id: savedId, slack_user_id: f.employee_key, full_name: f.employee_name, location: f.location, occurrence_type: f.occurrence_type,
          occurrence_date: f.occurrence_date, scheduled_shift_start: fmtTime(f.sched_date, f.sched_time, zone),
          actual_arrival: fmtTime(f.arrival_date, f.arrival_time, zone), minutes_late: f.minutes_late,
          notification_time: f.notification_time ? `${f.notification_time} ${abbrOn(zone, f.occurrence_date)}` : '', shift_affected: f.shift_affected, protected: f.protected,
          sick_vacation: f.sick_vacation, notice_given: f.notice_given, reason: f.reason,
          kiosk_closed_due_to_delay: f.kiosk_closed_due_to_delay, management_notified_before_shift: f.management_notified_before_shift,
        },
      })
      onSaved('Occurrence saved.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const bad = (key) => (submitted && !String(f[key] || '').trim() ? 'att-invalid' : '')
  const sel = (key, options) => <select className={bad(key)} value={f[key]} onChange={(e) => set(key, e.target.value)}>
    <option value="">Select…</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>

  return <div className="att-overlay" role="dialog" aria-modal="true">
    <div className="att-modal">
      <div className="att-modal-head"><h3>Disney Call-Out Log</h3><button className="att-link" onClick={onClose}>Close ✕</button></div>

      <div className="att-form">
        <label className="att-span2">Employee Name *
          {chosen
            ? <div className="att-chosen">{chosen.full_name} <small className="att-muted">· {chosen.slack_user_id}</small> <button type="button" className="att-link" onClick={() => setF((p) => ({ ...p, employee_key: '', employee_name: '', location: '' }))}>change</button></div>
            : <>
                <div className="att-search-row">
                  <input className={bad('employee_key')} placeholder="Type at least 3 letters of the name" value={f.employee_search}
                    onChange={(e) => set('employee_search', e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch() } }} />
                  <button type="button" className="att-search-btn" onClick={runSearch}>Search</button>
                </div>
                {searchHint && <small className="att-muted">{searchHint}</small>}
                {searchTerm.length >= 3 && matches.length === 0 && <small className="att-muted">No Slack user matches “{searchTerm}”.</small>}
                {matches.length > 0 && <div className="att-results">{matches.map((e) => <button type="button" key={e.slack_user_id} onClick={() => pickEmployee(e)}>{e.full_name} <small>{e.saved ? 'saved' : 'new'} · {e.slack_user_id}</small></button>)}</div>}
              </>}
        </label>
        <label>Location *
          <select className={bad('location')} value={f.location} onChange={(e) => chooseLocation(e.target.value)}>
            <option value="">Select…</option>{LOCATIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <small className="att-muted">{zone ? `Current time there: ${nowIn(zone, now)}` : 'Choose a location to see its current time.'}</small>
        </label>
        <label>Type of Occurrence *{sel('occurrence_type', OCCURRENCE_TYPES)}</label>

        <label>Scheduled shift start (date) *<input type="date" className={bad('sched_date')} value={f.sched_date} onChange={(e) => set('sched_date', e.target.value)} />
          {zone && <small className="att-muted">Today there: {prettyDate(zoneDate)}</small>}</label>
        <label>Scheduled shift start (time, {zone ? abbrOn(zone, f.sched_date || zoneDate) : 'location time'}) *<input type="time" className={bad('sched_time')} value={f.sched_time} onChange={(e) => set('sched_time', e.target.value)} />
          {zone && f.sched_time && <small className="att-muted">Saved as {fmtTime(f.sched_date, f.sched_time, zone)}</small>}</label>
        <label>Actual arrival (date, if tardy)<input type="date" value={f.arrival_date} onChange={(e) => set('arrival_date', e.target.value)} /></label>
        <label>Actual arrival (time, if tardy)<input type="time" value={f.arrival_time} onChange={(e) => set('arrival_time', e.target.value)} />
          {zone && f.arrival_time && <small className="att-muted">Saved as {fmtTime(f.arrival_date || f.sched_date, f.arrival_time, zone)}</small>}</label>

        <label>Minutes late<input type="number" min="0" placeholder="Fills in from the times above" value={f.minutes_late} onChange={(e) => set('minutes_late', e.target.value)} />
          <small className="att-muted">{autoLate !== null ? `Auto-calculated: ${autoLate} min. You can change it.` : 'Enter the scheduled and actual times to calculate this automatically.'}</small></label>
        <label>Date of Occurrence *<input type="date" className={bad('occurrence_date')} value={f.occurrence_date} onChange={(e) => set('occurrence_date', e.target.value)} />
          {zone && <small className="att-muted">Today there: {prettyDate(zoneDate)} · {abbrOn(zone, zoneDate)}</small>}</label>
        <label>Time of Notification *<input className={bad('notification_time')} placeholder="9:00AM" value={f.notification_time} onChange={(e) => set('notification_time', e.target.value)} />
          <small className="att-muted">{zone ? `${abbrOn(zone, f.occurrence_date)} (location time), 12-hour format, for example 9:00AM` : 'Location time, 12-hour format, for example 9:00AM'}</small></label>
        <label>Shift Affected *{sel('shift_affected', SHIFTS)}</label>

        <label>Protected *{sel('protected', YES_NO)}</label>
        <label>Sick/Vacation *{sel('sick_vacation', YES_NO)}</label>
        <label>Notice Given *{sel('notice_given', NOTICE_OPTIONS)}</label>
        <label>Kiosk closed due to delay? *{sel('kiosk_closed_due_to_delay', YES_NO)}</label>
        <label className="att-span2">Management notified before shift start? *{sel('management_notified_before_shift', YES_NO)}</label>
        <label className="att-span2">Reason Provided *<textarea rows="3" className={bad('reason')} value={f.reason} onChange={(e) => set('reason', e.target.value)} /></label>
      </div>

      <div className="att-preview">
        <div className="att-preview-points"><span>Points</span><strong>{preview ? preview.points : '—'}</strong></div>
        <div className="att-preview-meta">
          <div><span>Submitted by</span> {submittedBy} <small className="att-muted">{submittedRole}</small></div>
          <div className="att-muted">{!preview ? 'Choose an employee, type and date to see points.'
            : isMissed ? `Missed or forgotten entries in the 180 days before this date: ${preview.prior}`
            : 'Protected sick or vacation is always 0 points.'}</div>
        </div>
      </div>
      {submitted && missing.length > 0 && <div className="form-error">Please fill: {missing.map(([, label]) => label).join(', ')}</div>}
      {error && <div className="form-error">{error}</div>}
      <div className="att-actions"><button type="button" className="att-cancel" onClick={onClose}>Cancel</button><button className="att-new" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit'}</button></div>
    </div>
  </div>
}

function RecordsPanel({ records, canOverride, token, onChanged }) {
  const [location, setLocation] = useState('All')
  const [band, setBand] = useState('All')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [adjust, setAdjust] = useState(null)

  // Per-employee numbers use all records. The dashboard is about the rolling 180 days.
  // "Today" is taken in each employee's location time zone (latest record's location),
  // so a Florida employee's window ends on Florida's date and a California one on Pacific's.
  const summary = useMemo(() => {
    const ids = [...new Set(records.map((r) => r.employee_id))]
    return ids.map((id) => {
      const latest = records.find((r) => r.employee_id === id)
      const zone = zoneFor(latest?.location)
      const now = todayIn(zone)
      const rolling = rollingTotal(records, id, now)
      const monthPoints = records
        .filter((r) => r.employee_id === id && r.occurrence_date.startsWith(now.slice(0, 7)))
        .reduce((sum, r) => sum + Number(r.points), 0)
      const name = latest?.employee_name || ''
      return { id, name, monthPoints, rolling, band: thresholdBand(rolling), zone }
    }).sort((a, b) => a.rolling - b.rolling || a.name.localeCompare(b.name))
  }, [records])

  const bandOf = (id) => summary.find((s) => s.id === id)?.band
  const summaryRows = summary.filter((s) =>
    (!search || s.name.toLowerCase().includes(search.toLowerCase())) && (band === 'All' || s.band.key === band))
  const rows = records.filter((r) => {
    if (location !== 'All' && r.location !== location) return false
    if (band !== 'All' && bandOf(r.employee_id)?.key !== band) return false
    if (search && !r.employee_name.toLowerCase().includes(search.toLowerCase())) return false
    if (from && r.occurrence_date < from) return false
    if (to && r.occurrence_date > to) return false
    return true
  })
  const counts = BAND_ORDER.reduce((acc, key) => ({ ...acc, [key]: summary.filter((s) => s.band.key === key).length }), {})

  function exportCsv() {
    const header = ['Date', 'Employee', 'Location', 'Occurrence', 'Shift', 'Notice', 'Minutes late', 'Protected', 'Sick/Vacation', 'Kiosk closed', 'Mgmt notified', 'Points', 'Points adjusted', 'Submitted by', 'Submitted role', 'Reason']
    const lines = rows.map((r) => [r.occurrence_date, r.employee_name, r.location || '', r.occurrence_type, r.shift_affected, r.notice_given, r.minutes_late ?? '', r.protected, r.sick_vacation, r.kiosk_closed_due_to_delay || '', r.management_notified_before_shift || '', r.points, r.points_overridden ? 'YES' : 'NO', r.submitted_by, r.submitted_role || '', r.reason])
    const csv = [header, ...lines].map((row) => row.map((v) => `"${String(v ?? '').split('"').join('""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = `attendance-${todayIn(zoneFor(''))}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return <div className="att-stack">
    <div className="att-stats">
      <div className="att-stat"><span>Employees tracked</span><strong>{summary.length}</strong></div>
      <div className="att-stat yellow"><span>Verbal counseling</span><strong>{counts.verbal}</strong></div>
      <div className="att-stat orange"><span>Written warning</span><strong>{counts.written}</strong></div>
      <div className="att-stat red"><span>Employment review</span><strong>{counts.review}</strong></div>
    </div>

    <section className="att-card">
      <h3>Employee summary</h3>
      <div className="att-table-wrap"><table className="att-table">
        <thead><tr><th>Employee</th><th>This month</th><th>Rolling 180 days</th><th>Status</th></tr></thead>
        <tbody>
          {summaryRows.length === 0 && <tr><td colSpan="4" className="att-muted">No records match.</td></tr>}
          {summaryRows.map((s) => <tr key={s.id}>
            <td>{s.name}</td><td>{s.monthPoints.toFixed(1)}</td><td>{s.rolling.toFixed(1)}</td>
            <td><span className={`att-badge ${s.band.tone}`}>{s.band.label}</span></td>
          </tr>)}
        </tbody>
      </table></div>
    </section>

    <section className="att-card">
      <h3>Occurrence log</h3>
      <div className="att-filters">
        <label>Location<select value={location} onChange={(e) => setLocation(e.target.value)}><option>All</option>{LOCATIONS.map((l) => <option key={l}>{l}</option>)}</select></label>
        <label>Threshold<select value={band} onChange={(e) => setBand(e.target.value)}>
          <option value="All">All</option><option value="standard">Within Standards</option><option value="verbal">Verbal Counseling</option>
          <option value="written">Written Warning</option><option value="review">Employment Review</option></select></label>
        <label>Search employee<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name" /></label>
        <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="secondary-button" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
      </div>
      <div className="att-table-wrap"><table className="att-table">
        <thead><tr><th>Date</th><th>Employee</th><th>Location</th><th>Occurrence</th><th>Shift</th><th>Notice</th><th>Min late</th><th>Protected</th><th>Kiosk closed</th><th>Mgmt notified</th><th>Points</th><th>Submitted by</th>{canOverride && <th></th>}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={canOverride ? 13 : 12} className="att-muted">No records match these filters.</td></tr>}
          {rows.map((r) => <tr key={r.id}>
            <td>{r.occurrence_date}</td><td>{r.employee_name}</td><td>{r.location || '—'}</td><td>{r.occurrence_type}</td><td>{r.shift_affected}</td><td>{r.notice_given}</td>
            <td>{r.minutes_late ?? '—'}</td><td>{r.protected}</td><td>{r.kiosk_closed_due_to_delay || '—'}</td><td>{r.management_notified_before_shift || '—'}</td>
            <td><strong>{Number(r.points).toFixed(1)}</strong>{r.points_overridden && <small className="att-muted"> (adjusted)</small>}</td>
            <td>{r.submitted_by}</td>
            {canOverride && <td><button className="att-link" onClick={() => setAdjust({ id: r.id, points: String(r.points), name: r.employee_name })}>Adjust</button></td>}
          </tr>)}
        </tbody>
      </table></div>
    </section>

    {adjust && <AdjustModal state={adjust} token={token} onClose={() => setAdjust(null)} onDone={(msg) => { setAdjust(null); onChanged(msg) }} />}
  </div>
}

function AdjustModal({ state, token, onClose, onDone }) {
  const [points, setPoints] = useState(state.points)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true); setError('')
    try {
      await attendanceApi('records', { method: 'PATCH', token, body: { id: state.id, points: Number(points), reason } })
      onDone('Points updated.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <div className="att-overlay"><div className="att-modal att-small">
    <div className="att-modal-head"><h3>Adjust points · {state.name}</h3><button className="att-link" onClick={onClose}>Close ✕</button></div>
    <label>Points<input type="number" min="0" step="0.5" value={points} onChange={(e) => setPoints(e.target.value)} /></label>
    <label>Reason for change (required, logged in audit)<textarea rows="3" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    {error && <div className="form-error">{error}</div>}
    <div className="att-actions"><button type="button" className="att-cancel" onClick={onClose}>Cancel</button><button className="att-new" disabled={busy || !reason.trim()} onClick={save}>Save</button></div>
  </div></div>
}
