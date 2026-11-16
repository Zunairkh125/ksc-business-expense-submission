// Run: node lib/attendance/points.test.mjs
import assert from 'node:assert/strict'
import { calculatePoints, missedPoints, thresholdBand, priorMissedCountFrom, rollingTotal } from './points.js'

const base = { protected: 'NO', sickVacation: 'NO', noticeGiven: '<12 hrs', minutesLate: '' }

// Rule 1
assert.equal(calculatePoints({ ...base, protected: 'YES', sickVacation: 'YES', type: 'No Call / No Show' }), 0)
assert.equal(calculatePoints({ ...base, protected: 'YES', sickVacation: 'NO', type: 'No Call / No Show' }), 3)

// Rule 2
assert.equal(missedPoints(0), 0); assert.equal(missedPoints(1), 0.5); assert.equal(missedPoints(2), 1); assert.equal(missedPoints(3), 1.5); assert.equal(missedPoints(9), 1.5)
assert.equal(calculatePoints({ ...base, type: 'Missed Clock Out' }, 1), 0.5)

// Rule 3
assert.equal(calculatePoints({ ...base, type: 'Late', minutesLate: 5 }), 0)
assert.equal(calculatePoints({ ...base, type: 'Late', minutesLate: 12 }), 1)
assert.equal(calculatePoints({ ...base, type: 'Late', minutesLate: 25 }), 3)
assert.equal(calculatePoints({ ...base, type: 'Late', minutesLate: '', noticeGiven: '12+ hrs' }), 0.5)
assert.equal(calculatePoints({ ...base, type: 'Late', minutesLate: '', noticeGiven: '<12 hrs' }), 1.5)
assert.equal(calculatePoints({ ...base, type: 'Late', minutesLate: '', noticeGiven: 'No-call/no-show' }), 3)

// Rule 4
const fixed = {
  'Call Out 12+ hrs': 0.5, 'Call Out <12 hrs': 1.5, 'No Call / No Show': 3, 'Tardy (0-5 Minutes)': 0,
  'Tardy (6+ Minutes)': 1, 'Tardy (6–15 Minutes)': 1, 'Tardy (20+ Minutes)': 3, 'Tardy (30+ Minutes)': 3,
  'Unauthorized Shift Trade': 3, 'Late Shift Trade (<24 hrs)': 1.5,
}
for (const [type, pts] of Object.entries(fixed)) assert.equal(calculatePoints({ ...base, type }), pts, type)

// Thresholds
assert.equal(thresholdBand(1.0).key, 'standard'); assert.equal(thresholdBand(1.5).key, 'verbal'); assert.equal(thresholdBand(2.9).key, 'verbal')
assert.equal(thresholdBand(3).key, 'written'); assert.equal(thresholdBand(4.4).key, 'written'); assert.equal(thresholdBand(4.5).key, 'review')

// Window: 180 days before the date, exclusive of the date itself
const rows = [
  { employee_id: 'e1', occurrence_type: 'Missed Clock In', occurrence_date: '2026-06-01', points: 0 },
  { employee_id: 'e1', occurrence_type: 'Missed Clock Out', occurrence_date: '2026-09-01', points: 0 },
  { employee_id: 'e1', occurrence_type: 'Missed Clock Out', occurrence_date: '2026-10-20', points: 0 },
  { employee_id: 'e2', occurrence_type: 'Missed Clock Out', occurrence_date: '2026-09-01', points: 0 },
]
assert.equal(priorMissedCountFrom(rows, 'e1', '2026-10-20'), 2) // 06-01 is 141 days before, included
assert.equal(rollingTotal([{ employee_id: 'e1', occurrence_date: '2026-10-01', points: 1.5 }, { employee_id: 'e1', occurrence_date: '2026-01-01', points: 9 }], 'e1', '2026-10-23'), 1.5)

console.log('points tests passed')

// Dash variants (sheet uses "6-15", the form uses "6–15")
import { normalizeType } from './points.js'
assert.equal(calculatePoints({ ...base, type: 'Tardy (6-15 Minutes)', minutesLate: 13 }), 1)
assert.equal(calculatePoints({ ...base, type: 'Tardy (6–15 Minutes)' }), 1)
assert.equal(normalizeType('Tardy (6–15 Minutes)'), 'Tardy (6-15 Minutes)')
console.log('dash tests passed')
