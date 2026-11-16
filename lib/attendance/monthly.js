// Attendance monthly report. Replaces the paused "Disney Attendance Points Zap".
// On the 1st of each month (Los Angeles date) it:
//  1. posts the employee-wise summary to the attendance Slack channel,
//  2. sends each employee their own status message (Slack DM),
//  3. sends each admin a copy of that message,
//  4. posts the flagged list (Verbal / Written / Review) to the HR alert channel.
// Steps 2-4 only run when ATTENDANCE_DM_ENABLED=true (safety switch, like the Birthday reminder).
// Triggered by the external scheduler: /api/birthday?route=monthly-cron&job=attendance
import { env, clean } from '../birthday/env.js'
import { db, must } from '../birthday/supabase.js'
import { postToChannel, sendDm, sendGroupDm } from '../birthday/slack.js'
import { addDays } from './points.js'
import { statusMessage, adminCopyMessage, hrAlertMessage, prettyDate, num } from './messages.js'

const DEFAULT_SUMMARY_CHANNEL = 'C08L5BTE0HE' // channel used by the old Zap
const DEFAULT_HR_CHANNEL = 'C0AJJJ6S0ES'      // HR alert channel used by the old Zap
const DEFAULT_ADMIN_IDS = ['U06TBHB8G94', 'U06FS02HY4D', 'U06P20LUC86', 'U015R9U628N'] // Lauren, Blakeli, Sarah, Roxanne
const TIMEZONE = 'America/Los_Angeles'
const PAUSE_MS = 250

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function laToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (t) => parts.find((p) => p.type === t).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

// "YYYY-MM" of the month before `today`.
export function previousMonthKey(today) {
  let y = Number(today.slice(0, 4))
  let m = Number(today.slice(5, 7)) - 1
  if (m === 0) { m = 12; y -= 1 }
  return `${y}-${String(m).padStart(2, '0')}`
}

// Pure: one row per employee with records: rolling 180-day total and previous-month total.
export function buildRows(employees, records, today) {
  const prev = previousMonthKey(today)
  const rows = []
  for (const e of employees) {
    // Same window as the Zap: 180 days ending on the last day of the previous month (inclusive).
    const end = addDays(today, -1)
    const start = addDays(end, -179)
    const mine = records.filter((r) => r.employee_id === e.id && r.occurrence_date >= start && r.occurrence_date <= end)
    if (!mine.length) continue
    const rolling = mine.reduce((sum, r) => sum + Number(r.points || 0), 0)
    const last = mine.filter((r) => r.occurrence_date.startsWith(prev)).reduce((sum, r) => sum + Number(r.points), 0)
    rows.push({ id: e.id, name: e.full_name, slack_user_id: e.slack_user_id, rolling, last })
  }
  rows.sort((a, b) => b.rolling - a.rolling || a.name.localeCompare(b.name))
  return rows
}

// Pure: the channel summary, same wording as the old Zap.
export function buildSummaryText(rows, today, rangeText) {
  const lines = rows.map((r) => `• *${r.name}*: Rolling 180-day: ${num(r.rolling)} pts | Last Month: ${num(r.last)} pts`)
  return [
    '📊 *Employee Points Summary (Last Month & Rolling 180-days)*',
    `📆 _Rolling 180-day range: ${rangeText}_`,
    '',
    ...lines,
  ].join('\n')
}

// The 180-day range from the first to the last occurrence actually inside the window (as the Zap did).
export function rangeOf(records, today) {
  const end = addDays(today, -1)
  const from = addDays(end, -179)
  const dates = records.map((r) => r.occurrence_date).filter((d) => d >= from && d <= end).sort()
  if (!dates.length) return `${prettyDate(from)} → ${prettyDate(end)}`
  return `${prettyDate(dates[0])} → ${prettyDate(dates[dates.length - 1])}`
}

export function dmMode() {
  return clean(env('ATTENDANCE_DM_MODE', 'group')) === 'separate' ? 'separate' : 'group'
}

export function adminIds() {
  const configured = clean(env('ATTENDANCE_ADMIN_SLACK_IDS'))
  return configured ? configured.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ADMIN_IDS
}

async function loadData() {
  const employees = must(
    await db().from('attendance_employees').select('id, full_name, slack_user_id').eq('active', true),
    'Could not load employees',
  )
  const records = must(
    await db().from('attendance_occurrences').select('employee_id, occurrence_date, points')
      .gte('occurrence_date', addDays(laToday(), -400)).limit(20000),
    'Could not load records',
  )
  return { employees, records }
}

// Sends one message, never throws. Returns true if it went out.
async function dm(slackUserId, text, failures) {
  if (!slackUserId) return false
  try {
    await sendDm(slackUserId, text)
    await pause(PAUSE_MS)
    return true
  } catch (error) {
    failures.push({ to: slackUserId, error: error.message })
    return false
  }
}

// Monthly job (1st of the month). Force skips the date check.
export async function runAttendanceSummary(now = new Date(), opts = {}) {
  const today = laToday(now)
  if (!opts.force && today.slice(8, 10) !== '01') return { skipped: true, date: today, reason: 'Not the 1st of the month.' }

  const { employees, records } = await loadData()
  const rows = buildRows(employees, records, today)
  const prev = previousMonthKey(today)

  // 1. Channel summary (as before).
  const rangeText = rangeOf(records, today)
  const summaryText = buildSummaryText(rows, today, rangeText)
  await postToChannel(env('ATTENDANCE_REPORT_CHANNEL', DEFAULT_SUMMARY_CHANNEL), summaryText)
  // The old Zap also posted the same summary to the HR channel.
  await postToChannel(env('ATTENDANCE_HR_CHANNEL', DEFAULT_HR_CHANNEL), summaryText).catch(() => {})
  const result = { date: today, month: prev, employees: rows.length, summary_posted: true }

  if (env('ATTENDANCE_DM_ENABLED') !== 'true') {
    return { ...result, dm: 'skipped', reason: 'ATTENDANCE_DM_ENABLED is not true.' }
  }

  // Idempotency: a cron retry must not send the messages twice in the same month.
  const done = must(
    await db().from('attendance_audit_log').select('id').eq('action', 'attendance_monthly_sent').eq('details->>month', prev).limit(1),
    'Could not check the audit log',
  )
  if (done.length && !opts.force) return { ...result, dm: 'skipped', reason: `Already sent for ${prev}.` }

  const failures = []
  const admins = adminIds()
  let employeeDms = 0
  let adminCopies = 0
  if (dmMode() === 'group') {
    // One group DM per employee: the employee and the admins together (same as the old Zap).
    for (const row of rows) {
      if (!row.slack_user_id) continue
      const members = [...new Set([row.slack_user_id, ...admins])].slice(0, 8)
      try {
        await sendGroupDm(members, statusMessage(row, prev, today))
        employeeDms += 1
        await pause(PAUSE_MS)
      } catch (error) {
        failures.push({ to: row.name, error: error.message })
      }
    }
  } else {
    // Separate 1-on-1 DMs: employee gets their own, each admin gets a copy.
    for (const row of rows) {
      if (await dm(row.slack_user_id, statusMessage(row, prev, today), failures)) employeeDms += 1
      for (const admin of admins) {
        if (await dm(admin, adminCopyMessage(row, prev, today), failures)) adminCopies += 1
      }
    }
  }

  // 4. HR alert channel.
  let hrAlert = true
  try {
    await postToChannel(env('ATTENDANCE_HR_CHANNEL', DEFAULT_HR_CHANNEL), hrAlertMessage(rows, rangeText))
  } catch (error) {
    hrAlert = false
    failures.push({ to: 'HR channel', error: error.message })
  }

  must(
    await db().from('attendance_audit_log').insert({ actor: 'system', action: 'attendance_monthly_sent', details: { month: prev, employee_dms: employeeDms, admin_copies: adminCopies } }),
    'Could not write the audit log',
  )
  return { ...result, dm: 'sent', employee_dms: employeeDms, admin_copies: adminCopies, hr_alert: hrAlert, failures }
}

// Test route. Sends only to the IDs you name, never to the real admins unless you name them.
//   default: one personal DM to slackUserId.
//   group=true with admins: one group DM with slackUserId plus the given admin IDs (same shape as the real run).
// Messages are marked TEST. Works even when ATTENDANCE_DM_ENABLED is off.
export async function runAttendanceTest(now = new Date(), slackUserId, opts = {}) {
  const today = laToday(now)
  const { employees, records } = await loadData()
  const rows = buildRows(employees, records, today)
  const emp = employees.find((e) => e.slack_user_id === slackUserId)
  const row = rows.find((r) => r.slack_user_id === slackUserId)
    || { name: emp?.full_name || 'Test user', slack_user_id: slackUserId, rolling: 0, last: 0 }
  const banner = '🧪 *TEST MESSAGE – please ignore*\n\n'
  const text = banner + statusMessage(row, previousMonthKey(today), today)
  const failures = []

  if (opts.group && opts.admins && opts.admins.length) {
    const members = [...new Set([slackUserId, ...opts.admins])].slice(0, 8)
    try {
      await sendGroupDm(members, text)
      return { sent: true, mode: 'group', members, employee: row.name, failures }
    } catch (error) {
      return { sent: false, mode: 'group', members, employee: row.name, failures: [{ error: error.message }] }
    }
  }
  const sent = await dm(slackUserId, text, failures)
  return { sent, mode: 'personal', employee: row.name, failures }
}
