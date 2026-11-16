// Disney Call-Out points engine. Pure functions only (no I/O), so the browser preview and the
// server use exactly the same rules. The server is the source of truth on submit.

export const MISSED_TYPES = ['Missed Clock In', 'Missed Clock Out', 'Forgotten Clock in / Clock Out']

export const LOCATIONS = ['DCA California', 'DTD California', 'DSD Florida']
export const OCCURRENCE_TYPES = [
  'Call Out 12+ hrs', 'Call Out <12 hrs', 'No Call / No Show',
  'Tardy (0-5 Minutes)', 'Tardy (6+ Minutes)', 'Tardy (6–15 Minutes)', 'Tardy (20+ Minutes)', 'Tardy (30+ Minutes)',
  'Missed Clock In', 'Missed Clock Out', 'Forgotten Clock in / Clock Out',
  'Late', 'Late Shift Trade (<24 hrs)', 'Unauthorized Shift Trade',
]
export const SHIFTS = ['Open', 'Mid', 'Swing', 'Close', 'Restock']
export const NOTICE_OPTIONS = ['12+ hrs', '<12 hrs', 'No-call/no-show']
export const YES_NO = ['YES', 'NO']

// Rule 2: progressive points for missed / forgotten clock entries.
export function missedPoints(priorCount) {
  if (priorCount <= 0) return 0
  if (priorCount === 1) return 0.5
  if (priorCount === 2) return 1
  return 1.5
}

function noticePoints(notice) {
  if (notice === '12+ hrs') return 0.5
  if (notice === '<12 hrs') return 1.5
  if (notice === 'No-call/no-show') return 3
  return 0
}

function hasMinutes(value) {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

// input: { type, protected, sickVacation, noticeGiven, minutesLate }
// priorMissedCount: how many Missed/Forgotten entries this employee had in the 180 days before this one.
// Sheet exports use a plain hyphen where the form uses an en-dash (for example "6-15" vs "6–15").
export function normalizeType(value) {
  return String(value ?? '').replace(/[\u2012-\u2015\u2212]/g, '-').trim()
}

export function calculatePoints(input, priorMissedCount = 0) {
  const { sickVacation, noticeGiven, minutesLate } = input
  const type = normalizeType(input.type)
  const isProtected = input.protected

  // Rule 1: protected absence (sick/vacation) is always 0.
  if (isProtected === 'YES' && sickVacation === 'YES') return 0

  // Rule 2
  if (MISSED_TYPES.includes(type)) return missedPoints(priorMissedCount)

  // Rule 3
  if (type === 'Late') {
    if (hasMinutes(minutesLate)) {
      const minutes = Number(minutesLate)
      if (minutes <= 5) return 0
      if (minutes <= 15) return 1
      return 3
    }
    return noticePoints(noticeGiven)
  }

  // Rule 4: fixed occurrence types
  switch (type) {
    case 'Call Out 12+ hrs': return 0.5
    case 'Call Out <12 hrs': return 1.5
    case 'No Call / No Show': return 3
    case 'Tardy (0-5 Minutes)': return 0
    case 'Tardy (6+ Minutes)':
    case 'Tardy (6-15 Minutes)': return 1
    case 'Tardy (20+ Minutes)':
    case 'Tardy (30+ Minutes)': return 3
    case 'Unauthorized Shift Trade': return 3
    case 'Late Shift Trade (<24 hrs)': return 1.5
    default: return noticePoints(noticeGiven)
  }
}

// Threshold bands used on the dashboard (rolling 180-day total).
export function thresholdBand(points) {
  if (points >= 4.5) return { key: 'review', label: 'Termination / Employment Review', tone: 'red' }
  if (points >= 3) return { key: 'written', label: 'Written Warning', tone: 'orange' }
  if (points >= 1.5) return { key: 'verbal', label: 'Verbal Counseling', tone: 'yellow' }
  return { key: 'standard', label: 'Within Standards', tone: 'green' }
}

// Date helpers on plain YYYY-MM-DD strings (no timezone shifts).
export function addDays(dateString, days) {
  const [y, m, d] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

export function isWithinDays(dateString, fromString, toString) {
  return dateString >= fromString && dateString <= toString
}

// Counts Missed/Forgotten entries for one employee in the 180 days before `date` (exclusive).
export function priorMissedCountFrom(rows, employeeId, date) {
  const start = addDays(date, -180)
  return rows.filter((row) =>
    row.employee_id === employeeId &&
    MISSED_TYPES.includes(row.occurrence_type) &&
    row.occurrence_date >= start &&
    row.occurrence_date < date,
  ).length
}

// Rolling 180-day total (inclusive of today) for one employee.
export function rollingTotal(rows, employeeId, today) {
  const start = addDays(today, -180)
  return rows
    .filter((row) => row.employee_id === employeeId && row.occurrence_date >= start && row.occurrence_date <= today)
    .reduce((sum, row) => sum + Number(row.points || 0), 0)
}
