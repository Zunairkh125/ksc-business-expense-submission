// Login card for the Attendance & Call-Out tab (shown on the sign-in page as its own product tab).
// Lauren and Andree get a 4-digit PIN by Slack DM. Admin and HR use their Birthday username/password.
import { useEffect, useState } from 'react'
import { attendanceApi } from './attendanceApi.js'

const PEOPLE = [
  { key: 'lauren', label: 'Lauren Lazo', email: 'abby_cruz2@aol.com', pin: true },
  { key: 'andree', label: 'Andre Ramirez-Ortega', email: 'andrer4871@yahoo.com', pin: true },
  { key: 'uma', label: 'Uma', email: 'uma@kawaiislimecompany.com', pin: true },
  { key: 'admin', label: 'Admin / HR', pin: false },
]

export default function AttendanceLogin({ onLogin }) {
  const [who, setWho] = useState('lauren')
  const [step, setStep] = useState('choose')
  const [pin, setPin] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const person = PEOPLE.find((p) => p.key === who)

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function sendPin() {
    setBusy(true); setError(''); setMessage('')
    try {
      const data = await attendanceApi('send-pin', { method: 'POST', body: { email: person.email } })
      setStep('pin'); setPin(''); setCooldown(data.cooldown_seconds || 60)
      setMessage("We've sent a 4-digit PIN to your Slack direct messages.")
    } catch (err) {
      setError(err.message)
      if (err.status === 429) setCooldown(60)
    } finally { setBusy(false) }
  }

  async function verifyPin(event) {
    event?.preventDefault()
    setBusy(true); setError('')
    try {
      const data = await attendanceApi('verify-pin', { method: 'POST', body: { email: person.email, pin } })
      onLogin({ kind: 'attendance', token: data.token, name: data.user.name, role: data.user.role })
    } catch (err) {
      setError(err.message)
      if (err.status === 401 && /expired|Request a new PIN|Too many/i.test(err.message)) setStep('choose')
    } finally { setBusy(false) }
  }

  async function adminLogin(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/birthday?route=login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Sign in failed.')
      // Confirm the account can open Attendance (Admin and HR only).
      await attendanceApi('me', { token: data.token }).catch((err) => { throw new Error(err.status === 403 ? 'This account cannot open Attendance & Call-Out. Only Admin and HR can.' : err.message) })
      onLogin({ kind: 'birthday', token: data.token, name: data.user.name, role: data.user.role })
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return <div className="att-login">
    <p>Disney call-out and attendance log. Sign in with your Slack PIN, or with your Admin or HR account.</p>
    <label>Who are you?
      <select value={who} onChange={(e) => { setWho(e.target.value); setStep('choose'); setError(''); setMessage('') }}>
        {PEOPLE.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
    </label>

    {person.pin && step === 'choose' && <>
      <label>Email<input value={person.email} readOnly /></label>
      {error && <div className="form-error">{error}</div>}
      <button type="button" className="primary-button" disabled={busy} onClick={sendPin}>{busy ? 'Sending…' : 'Send Slack Verification PIN'}</button>
    </>}

    {person.pin && step === 'pin' && <form onSubmit={verifyPin}>
      {message && <div className="inline-message">{message}</div>}
      <label>4-digit PIN<input className="att-pin" inputMode="numeric" maxLength={4} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" /></label>
      {error && <div className="form-error">{error}</div>}
      <button className="primary-button" disabled={busy || pin.length !== 4}>{busy ? 'Checking…' : 'Verify & Login'}</button>
      <button type="button" className="secondary-button att-resend" disabled={busy || cooldown > 0} onClick={sendPin}>{cooldown > 0 ? `Resend PIN in ${cooldown}s` : 'Resend PIN'}</button>
    </form>}

    {!person.pin && <form onSubmit={adminLogin}>
      <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter your username" autoComplete="username" required /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password" required /></label>
      {error && <div className="form-error">{error}</div>}
      <button className="primary-button" disabled={busy}>{busy ? 'Signing in…' : 'Open Attendance & Call-Out →'}</button>
    </form>}
  </div>
}
