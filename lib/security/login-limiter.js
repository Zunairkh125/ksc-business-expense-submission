// Brute-force protection for username/password logins (Finance and Birthday).
// Counts wrong passwords per username in the `login_attempts` table. After
// MAX_FAILURES wrong passwords inside WINDOW_MS, the username is locked for LOCK_MS.
// A successful sign-in clears the counter.
//
// Serverless functions have no shared memory, so the counter lives in Supabase.
// The table must exist in every Supabase project that uses this helper
// (Finance project and Birthday project). See supabase/kawaii-hq-login-limits.sql.

export const MAX_FAILURES = 5
export const WINDOW_MS = 15 * 60 * 1000
export const LOCK_MS = 15 * 60 * 1000

const TABLE = 'login_attempts'

export function limiterKey(username) {
  return `login:${String(username || '').trim().toLowerCase()}`
}

// Returns { locked: boolean, retryAfterSeconds: number }.
// If the limiter cannot reach the database it returns locked:false and logs the error,
// so a database problem does not lock out every staff member.
export async function checkLoginLock(client, username) {
  try {
    const { data, error } = await client.from(TABLE).select('locked_until').eq('key', limiterKey(username)).maybeSingle()
    if (error) throw error
    const until = data?.locked_until ? Date.parse(data.locked_until) : 0
    if (until > Date.now()) {
      return { locked: true, retryAfterSeconds: Math.ceil((until - Date.now()) / 1000) }
    }
    return { locked: false, retryAfterSeconds: 0 }
  } catch (error) {
    console.error('login-limiter check failed:', error?.message || error)
    return { locked: false, retryAfterSeconds: 0 }
  }
}

// Call after a wrong password. Returns { locked, retryAfterSeconds }.
export async function recordLoginFailure(client, username) {
  const key = limiterKey(username)
  try {
    const now = Date.now()
    const { data, error: readError } = await client.from(TABLE).select('*').eq('key', key).maybeSingle()
    if (readError) throw readError

    const windowStart = data?.window_start ? Date.parse(data.window_start) : 0
    const inWindow = data && now - windowStart < WINDOW_MS
    const failures = inWindow ? (data.failures || 0) + 1 : 1
    const lockedUntil = failures >= MAX_FAILURES ? new Date(now + LOCK_MS).toISOString() : null

    const { error: writeError } = await client.from(TABLE).upsert({
      key,
      failures: lockedUntil ? 0 : failures,
      window_start: inWindow ? data.window_start : new Date(now).toISOString(),
      locked_until: lockedUntil,
      updated_at: new Date(now).toISOString(),
    })
    if (writeError) throw writeError

    return lockedUntil
      ? { locked: true, retryAfterSeconds: Math.ceil(LOCK_MS / 1000) }
      : { locked: false, retryAfterSeconds: 0 }
  } catch (error) {
    console.error('login-limiter record failed:', error?.message || error)
    return { locked: false, retryAfterSeconds: 0 }
  }
}

// Call after a successful sign-in.
export async function clearLoginFailures(client, username) {
  try {
    const { error } = await client.from(TABLE).delete().eq('key', limiterKey(username))
    if (error) throw error
  } catch (error) {
    console.error('login-limiter clear failed:', error?.message || error)
  }
}

export function lockMessage(retryAfterSeconds) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
  return `Too many failed attempts. Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
}

// Sends a Slack DM to the security alert recipients (env SECURITY_ALERT_SLACK_IDS, comma-separated user IDs).
// Called once when an identifier gets locked, so admins can spot someone guessing.
export async function notifyLockout({ app, identifier }) {
  try {
    const { sendDm } = await import('../birthday/slack.js')
    const recipients = String(process.env.SECURITY_ALERT_SLACK_IDS || '')
      .split(',').map((id) => id.trim()).filter(Boolean)
    if (!recipients.length) {
      console.warn('SECURITY_ALERT_SLACK_IDS is not set; lockout alert not sent.', { app })
      return
    }
    const when = new Intl.DateTimeFormat('en-US', {
      timeZone: process.env.APP_TIMEZONE || 'Asia/Karachi',
      dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date())
    const text = `🚨 *Login locked: ${app}*\n\nToo many failed sign-in attempts (5) for: \`${String(identifier || '').slice(0, 120)}\`\nThis sign-in is blocked for 15 minutes.\nTime: ${when}\n\nIf you did not expect this, someone may be trying to guess the PIN or password.`
    await Promise.all(recipients.map((id) => sendDm(id, text).catch((error) => console.error('Lockout alert failed:', error?.message || error))))
  } catch (error) {
    console.error('Lockout alert failed:', error?.message || error)
  }
}
