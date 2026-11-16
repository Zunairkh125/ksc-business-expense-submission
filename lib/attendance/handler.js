// Attendance & Call-Out API. Mounted as /api/birthday?route=attendance&op=<name>.
// Access: Lauren and Andree sign in with a Slack PIN (attendance session, 8 hours).
// Admin and HR sign in with their existing Birthday username/password (birthday session).
import crypto from 'node:crypto'
import { clean, env, HttpError, methodNotAllowed, fail, bearerToken } from '../birthday/env.js'
import { db, must } from '../birthday/supabase.js'
import { slack, slackGet, sendDm } from '../birthday/slack.js'
import { currentSession } from '../birthday/auth.js'
import {
  calculatePoints, priorMissedCountFrom, MISSED_TYPES, LOCATIONS, OCCURRENCE_TYPES, SHIFTS, NOTICE_OPTIONS, YES_NO,
} from './points.js'

const SESSION_HOURS = 8
const PIN_MINUTES = 10
const PIN_MAX_ATTEMPTS = 3
const PIN_COOLDOWN_SECONDS = 60

// Only these people can receive a PIN. Admin and HR do not use PINs.
const AUTHORIZED = [
  { email: 'abby_cruz2@aol.com', name: 'Lauren Lazo', slackUserId: 'U06TBHB8G94' },
  { email: 'andrer4871@yahoo.com', name: 'Andre Ramirez-Ortega', slackUserId: null },
  { email: 'uma@kawaiislimecompany.com', name: 'Uma', slackUserId: null },
]
const ADMIN_BIRTHDAY_ROLES = ['super_admin', 'hr_admin']

function secret() {
  const value = env('HQ_SESSION_SECRET')
  if (!value) throw new HttpError(500, 'HQ_SESSION_SECRET is not configured in Vercel.')
  return value
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

function readSigned(token) {
  const [body, sig] = String(token || '').split('.')
  if (!body || !sig) return null
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  if (!payload.exp || payload.exp < Date.now()) return null
  return payload
}

function pinHash(email, pin) {
  return crypto.createHmac('sha256', secret()).update(`attendance-pin:${email}:${pin}`).digest('hex')
}

function findAuthorized(email) {
  return AUTHORIZED.find((person) => person.email === email) || null
}

// Who is calling? Returns { name, role, canOverride } or throws.
function actorFrom(req) {
  const token = bearerToken(req)
  const attendance = readSigned(token)
  if (attendance && attendance.scope === 'attendance') {
    return { name: attendance.name, role: 'Attendance Admin', canOverride: false, email: attendance.email }
  }
  const birthday = currentSession(req)
  if (birthday && ADMIN_BIRTHDAY_ROLES.includes(birthday.role)) {
    return { name: birthday.name, role: birthday.role === 'super_admin' ? 'Admin' : 'HR', canOverride: true, email: birthday.username }
  }
  if (birthday) throw new HttpError(403, 'Access Restricted: You do not have permission to view Attendance Records.')
  throw new HttpError(401, 'Your session has expired. Please sign in again.')
}

function nowIso() { return new Date().toISOString() }

function validDate(value, label) {
  const text = clean(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new HttpError(400, `${label} is required (YYYY-MM-DD).`)
  return text
}

function pick(value, options, label) {
  const text = clean(value)
  if (!options.includes(text)) throw new HttpError(400, `${label} is not a valid option.`)
  return text
}

// ---- PIN login ------------------------------------------------------------

async function sendPin(req, res) {
  const email = clean(req.body?.email).toLowerCase()
  const person = findAuthorized(email)
  if (!person) throw new HttpError(403, 'This email is not authorized for Attendance & Call-Out.')

  const last = must(
    await db().from('attendance_pin_challenges').select('created_at').eq('email', email).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    'Could not check PIN history',
  )
  if (last && Date.now() - new Date(last.created_at).getTime() < PIN_COOLDOWN_SECONDS * 1000) {
    throw new HttpError(429, `Please wait ${PIN_COOLDOWN_SECONDS} seconds before requesting another PIN.`)
  }

  // Resolve the Slack user: configured ID first, otherwise look up by email.
  let slackUserId = person.slackUserId
  if (!slackUserId) {
    const data = await slackGet('users.lookupByEmail', { email })
    slackUserId = data.user?.id
    if (!slackUserId) throw new HttpError(404, 'Could not find this email in Slack.')
  }

  const pin = crypto.randomInt(0, 10000).toString().padStart(4, '0')
  must(await db().from('attendance_pin_challenges').update({ used: true }).eq('email', email).eq('used', false), 'Could not reset old PINs')
  must(
    await db().from('attendance_pin_challenges').insert({
      email,
      pin_hash: pinHash(email, pin),
      expires_at: new Date(Date.now() + PIN_MINUTES * 60 * 1000).toISOString(),
    }),
    'Could not save PIN',
  )

  await sendDm(
    slackUserId,
    `🔐 *Disney Attendance Portal Verification*\n\nYour 4-digit login PIN is: *\`${pin}\`*\n\nThis code expires in ${PIN_MINUTES} minutes. If you did not request this code, please contact HR.`,
  )
  return res.status(200).json({ sent: true, expires_in_seconds: PIN_MINUTES * 60, cooldown_seconds: PIN_COOLDOWN_SECONDS })
}

async function verifyPin(req, res) {
  const email = clean(req.body?.email).toLowerCase()
  const pin = clean(req.body?.pin)
  const person = findAuthorized(email)
  if (!person) throw new HttpError(403, 'This email is not authorized for Attendance & Call-Out.')
  if (!/^\d{4}$/.test(pin)) throw new HttpError(400, 'Enter the 4-digit PIN.')

  const challenge = must(
    await db().from('attendance_pin_challenges').select('*')
      .eq('email', email).eq('used', false)
      .gt('expires_at', nowIso())
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    'Could not load PIN',
  )
  if (!challenge) throw new HttpError(401, 'This PIN has expired or was not found. Request a new PIN.')
  if (challenge.attempts >= PIN_MAX_ATTEMPTS) {
    await db().from('attendance_pin_challenges').update({ used: true }).eq('id', challenge.id)
    throw new HttpError(429, 'Too many wrong attempts. Request a new PIN.')
  }

  const given = Buffer.from(pinHash(email, pin))
  const stored = Buffer.from(challenge.pin_hash)
  const ok = given.length === stored.length && crypto.timingSafeEqual(given, stored)
  if (!ok) {
    const attempts = challenge.attempts + 1
    const left = PIN_MAX_ATTEMPTS - attempts
    await db().from('attendance_pin_challenges').update({ attempts, used: left <= 0 }).eq('id', challenge.id)
    throw new HttpError(401, left > 0 ? `Wrong PIN. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Wrong PIN. Request a new PIN.')
  }

  await db().from('attendance_pin_challenges').update({ used: true }).eq('id', challenge.id)
  const payload = { scope: 'attendance', email, name: person.name, exp: Date.now() + SESSION_HOURS * 3600 * 1000 }
  return res.status(200).json({ token: sign(payload), user: { name: person.name, role: 'Attendance Admin' } })
}


// ---- Slack status sync ----------------------------------------------------
// Keeps attendance_employees.active in step with Slack. A Slack account that is
// deactivated (users.info -> user.deleted = true) is set inactive and hidden
// everywhere; a reactivated account is set active again. Runs at most once every
// SYNC_MINUTES per warm instance so page loads stay fast.
const SYNC_MINUTES = 5
let lastSlackSync = 0

export async function syncSlackStatus({ force = false } = {}) {
  if (!force && Date.now() - lastSlackSync < SYNC_MINUTES * 60 * 1000) return { skipped: true }
  lastSlackSync = Date.now()

  const { data, error } = await db().from('attendance_employees').select('id, full_name, slack_user_id, active')
  if (error) throw new HttpError(500, 'Could not load employees for Slack sync')

  const summary = { checked: 0, deactivated: [], reactivated: [], unknown: [] }
  await Promise.all((data || []).filter((e) => e.slack_user_id).map(async (employee) => {
    let isDeleted
    try {
      const res = await slackGet('users.info', { user: employee.slack_user_id })
      if (!res.user) throw new Error(res.error || 'no user')
      isDeleted = res.user.deleted === true
    } catch (err) {
      // user_not_found also means the account is gone. Other errors (rate limit, network) leave status unchanged.
      if (String(err.message || err).includes('user_not_found')) isDeleted = true
      else { summary.unknown.push(employee.full_name); return }
    }
    summary.checked += 1
    const shouldBeActive = !isDeleted
    if (shouldBeActive === employee.active) return
    const { error: upErr } = await db().from('attendance_employees').update({ active: shouldBeActive }).eq('id', employee.id)
    if (upErr) { summary.unknown.push(employee.full_name); return }
    ;(shouldBeActive ? summary.reactivated : summary.deactivated).push(employee.full_name)
  }))
  return summary
}

// ---- Records --------------------------------------------------------------

async function listEmployees(req, res) {
  actorFrom(req)
  await syncSlackStatus().catch(() => {})
  const rows = must(
    await db().from('attendance_employees').select('id, full_name, slack_user_id, location').eq('active', true).order('full_name', { ascending: true }),
    'Could not load employees',
  )
  return res.status(200).json({ employees: rows })
}

async function listRecords(req, res) {
  actorFrom(req)
  // Deactivated (Slack-inactive) employees are hidden from every report, table and export.
  await syncSlackStatus().catch(() => {})
  const active = must(
    await db().from('attendance_employees').select('id').eq('active', true),
    'Could not load employees',
  )
  const activeIds = new Set(active.map((e) => e.id))
  const rows = must(
    await db().from('attendance_occurrences').select('*').order('occurrence_date', { ascending: false }).limit(5000),
    'Could not load records',
  )
  return res.status(200).json({ records: rows.filter((r) => activeIds.has(r.employee_id)) })
}

async function createRecord(req, res) {
  const actor = actorFrom(req)
  const b = req.body || {}
  // Either an existing employee id, or a Slack user picked from the workspace list (created on first use).
  let employee
  const employeeId = clean(b.employee_id)
  if (employeeId) {
    employee = must(
      await db().from('attendance_employees').select('id, full_name, slack_user_id, active').eq('id', employeeId).maybeSingle(),
      'Could not load employee',
    )
    if (!employee || !employee.active) throw new HttpError(400, 'Choose an active employee.')
  } else if (clean(b.slack_user_id)) {
    employee = await ensureEmployee(clean(b.slack_user_id), clean(b.full_name))
  } else {
    throw new HttpError(400, 'Employee is required.')
  }
  const employeeIdValue = employee.id

  const occurrenceDate = validDate(b.occurrence_date, 'Date of occurrence')
  const type = pick(b.occurrence_type, OCCURRENCE_TYPES, 'Type of occurrence')
  const location = pick(b.location, LOCATIONS, 'Location')
  const shift = pick(b.shift_affected, SHIFTS, 'Shift affected')
  const notice = pick(b.notice_given, NOTICE_OPTIONS, 'Notice given')
  const protectedValue = pick(b.protected, YES_NO, 'Protected')
  const sickVacation = pick(b.sick_vacation, YES_NO, 'Sick/Vacation')
  const kiosk = pick(b.kiosk_closed_due_to_delay, YES_NO, 'Kiosk closed')
  const managementNotified = pick(b.management_notified_before_shift, YES_NO, 'Management notified')
  const reason = clean(b.reason)
  const notificationTime = clean(b.notification_time)
  if (!reason) throw new HttpError(400, 'Reason is required.')
  if (!notificationTime) throw new HttpError(400, 'Time of notification is required.')
  const minutesLate = clean(b.minutes_late) === '' ? null : Number(b.minutes_late)
  if (minutesLate !== null && (Number.isNaN(minutesLate) || minutesLate < 0)) throw new HttpError(400, 'Minutes late must be a positive number.')

  // Prior Missed/Forgotten entries for the Rule 2 progressive count.
  const start = new Date(Date.parse(`${occurrenceDate}T00:00:00Z`) - 180 * 86400000).toISOString().slice(0, 10)
  const priorRows = must(
    await db().from('attendance_occurrences').select('employee_id, occurrence_type, occurrence_date')
      .eq('employee_id', employeeIdValue).in('occurrence_type', MISSED_TYPES)
      .gte('occurrence_date', start).lt('occurrence_date', occurrenceDate),
    'Could not check prior occurrences',
  )
  const priorCount = priorMissedCountFrom(priorRows, employeeIdValue, occurrenceDate)
  const points = calculatePoints(
    { type, protected: protectedValue, sickVacation, noticeGiven: notice, minutesLate },
    priorCount,
  )

  const record = must(
    await db().from('attendance_occurrences').insert({
      employee_id: employeeIdValue,
      employee_name: employee.full_name,
      slack_user_id: employee.slack_user_id,
      location,
      occurrence_type: type,
      occurrence_date: occurrenceDate,
      scheduled_shift_start: clean(b.scheduled_shift_start) || null,
      actual_arrival: clean(b.actual_arrival) || null,
      minutes_late: minutesLate,
      notification_time: notificationTime,
      shift_affected: shift,
      protected: protectedValue,
      sick_vacation: sickVacation,
      notice_given: notice,
      reason,
      kiosk_closed_due_to_delay: kiosk,
      management_notified_before_shift: managementNotified,
      points,
      submitted_by: actor.name,
      submitted_role: actor.role,
      source: 'app',
    }).select('*').single(),
    'Could not save occurrence',
  )
  // Keep the employee's default location up to date with what was entered on the form.
  if (location) must(await db().from('attendance_employees').update({ location }).eq('id', employee.id), 'Could not save employee location')
  await audit(actor.name, 'occurrence.created', record.id, { points, prior_missed_count: priorCount })
  return res.status(201).json({ success: true, record })
}

async function overridePoints(req, res) {
  const actor = actorFrom(req)
  if (!actor.canOverride) throw new HttpError(403, 'Only Admin or HR can change points.')
  const id = clean(req.body?.id)
  const reason = clean(req.body?.reason)
  const points = Number(req.body?.points)
  if (!id) throw new HttpError(400, 'Record ID is required.')
  if (!reason) throw new HttpError(400, 'A reason is required to change points.')
  if (Number.isNaN(points) || points < 0) throw new HttpError(400, 'Points must be 0 or more.')

  const before = must(await db().from('attendance_occurrences').select('points').eq('id', id).maybeSingle(), 'Could not load record')
  if (!before) throw new HttpError(404, 'Record not found.')
  const record = must(
    await db().from('attendance_occurrences').update({
      points, points_overridden: true, override_reason: reason, updated_at: nowIso(),
    }).eq('id', id).select('*').single(),
    'Could not update points',
  )
  await audit(actor.name, 'occurrence.points_overridden', id, { from: Number(before.points), to: points, reason })
  return res.status(200).json({ success: true, record })
}

async function audit(actor, action, occurrenceId, details) {
  must(
    await db().from('attendance_audit_log').insert({ actor, action, occurrence_id: occurrenceId, details }),
    'Could not write audit log',
  )
}

// ---- Slack workspace users ------------------------------------------------
// Everyone active in the Slack workspace, so the Employee Name search shows all of them,
// not only the people already saved in attendance_employees. Cached for 10 minutes per warm instance.
const SLACK_USERS_TTL_MS = 10 * 60 * 1000
let slackUsersCache = { at: 0, users: [] }

function isPersonAccount(u) {
  return !u.deleted && !u.is_bot && !u.is_app_user && u.id !== 'USLACKBOT' && !u.is_workflow_bot
}

export async function listSlackUsers() {
  if (Date.now() - slackUsersCache.at < SLACK_USERS_TTL_MS && slackUsersCache.users.length) return slackUsersCache.users
  const users = []
  let cursor = ''
  for (let page = 0; page < 30; page += 1) {
    const res = await slackGet('users.list', { limit: 200, cursor })
    for (const u of res.members || []) {
      if (!isPersonAccount(u)) continue
      const name = clean(u.profile?.real_name) || clean(u.real_name) || clean(u.profile?.display_name) || clean(u.name)
      if (name) users.push({ slack_user_id: u.id, full_name: name })
    }
    cursor = res.response_metadata?.next_cursor || ''
    if (!cursor) break
  }
  users.sort((a, b) => a.full_name.localeCompare(b.full_name))
  slackUsersCache = { at: Date.now(), users }
  return users
}

async function slackUsersOp(req, res) {
  actorFrom(req)
  const users = await listSlackUsers()
  return res.status(200).json({ users })
}

// Finds the attendance employee for a Slack user, creating the row the first time.
// The Slack account must be active (not deactivated) before anyone can be logged against it.
async function ensureEmployee(slackUserId, fallbackName) {
  let info
  try {
    info = await slackGet('users.info', { user: slackUserId })
  } catch {
    throw new HttpError(400, 'This Slack user could not be found.')
  }
  if (!info.user || info.user.deleted || info.user.is_bot) throw new HttpError(400, 'This Slack account is deactivated.')
  const name = clean(info.user.profile?.real_name) || clean(info.user.real_name) || fallbackName || clean(info.user.name)

  const existing = must(
    await db().from('attendance_employees').select('id, full_name, slack_user_id, active').eq('slack_user_id', slackUserId).maybeSingle(),
    'Could not load employee',
  )
  if (existing) {
    if (!existing.active) must(await db().from('attendance_employees').update({ active: true }).eq('id', existing.id), 'Could not reactivate employee')
    return { ...existing, active: true }
  }
  return must(
    await db().from('attendance_employees').insert({ full_name: name, slack_user_id: slackUserId, active: true })
      .select('id, full_name, slack_user_id, active').single(),
    'Could not save employee',
  )
}

// ---- Dispatch -------------------------------------------------------------

export default async function attendanceHandler(req, res) {
  try {
    const op = clean(req.query?.op)
    if (op === 'send-pin') { if (req.method !== 'POST') return methodNotAllowed(res); return await sendPin(req, res) }
    if (op === 'verify-pin') { if (req.method !== 'POST') return methodNotAllowed(res); return await verifyPin(req, res) }
    if (op === 'sync-slack') {
      if (req.method !== 'POST') return methodNotAllowed(res)
      actorFrom(req)
      return res.status(200).json(await syncSlackStatus({ force: true }))
    }
    if (op === 'slack-users') { if (req.method !== 'GET') return methodNotAllowed(res); return await slackUsersOp(req, res) }
    if (op === 'employees') { if (req.method !== 'GET') return methodNotAllowed(res); return await listEmployees(req, res) }
    if (op === 'records') {
      if (req.method === 'GET') return await listRecords(req, res)
      if (req.method === 'POST') return await createRecord(req, res)
      if (req.method === 'PATCH') return await overridePoints(req, res)
      return methodNotAllowed(res)
    }
    if (op === 'me') {
      const actor = actorFrom(req)
      return res.status(200).json({ me: { name: actor.name, role: actor.role, canOverride: actor.canOverride } })
    }
    return res.status(404).json({ error: 'Unknown attendance operation.' })
  } catch (error) {
    return fail(res, error, 'Attendance API error')
  }
}

// Exported for tests and the sign-in handler.
export { AUTHORIZED, SESSION_HOURS }
