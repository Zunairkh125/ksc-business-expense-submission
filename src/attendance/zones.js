// Location time zones. Florida is Eastern, California is Pacific. The browser's own
// time zone is never used, so an employee in Karachi still sees the Disney location's time.
// Intl handles daylight saving time (EST/EDT, PST/PDT) for each date automatically.
export const LOCATION_ZONES = {
  'DCA California': 'America/Los_Angeles',
  'DTD California': 'America/Los_Angeles',
  'DSD Florida': 'America/New_York',
}
export const DEFAULT_ZONE = 'America/Los_Angeles'
export const zoneFor = (location) => LOCATION_ZONES[location] || DEFAULT_ZONE

// Today's calendar date (YYYY-MM-DD) in a given zone.
export function todayIn(zone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type) => parts.find((p) => p.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

// Zone abbreviation (PDT/PST or EDT/EST) that applies on a given YYYY-MM-DD date.
// Noon is used so the check is never affected by the 2 AM DST switch.
export function abbrOn(zone, dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
    .formatToParts(new Date(Date.UTC(y, m - 1, d, 12)))
    .find((p) => p.type === 'timeZoneName')
  return part ? part.value : ''
}

// Current clock time in a zone, e.g. "3:12 PM EDT".
export function nowIn(zone, now = new Date()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }).format(now)
}

// Readable date, e.g. "Fri, Oct 23, 2026".
export function prettyDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d, 12)))
}

// UTC offset (ms) of a zone at a given instant: local wall-clock time minus UTC.
function offsetAt(zone, epochMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(epochMs))
  const v = (type) => Number(parts.find((p) => p.type === type).value)
  const asUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'))
  return asUtc - Math.floor(epochMs / 1000) * 1000
}

// Converts a wall-clock date+time in a zone to a real instant (ms since epoch).
// Handles daylight saving time: the offset is checked again at the resulting instant.
export function zonedToEpoch(zone, dateStr, timeStr) {
  if (!zone || !dateStr || !timeStr) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = timeStr.split(':').map(Number)
  if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) return null
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  let guess = wall - offsetAt(zone, wall)
  guess = wall - offsetAt(zone, guess)
  return guess
}

// Minutes between a scheduled shift start and actual arrival, both in the location's zone.
// Returns null when either time is missing. Early arrivals count as 0.
export function minutesLateBetween(zone, schedDate, schedTime, arrivalDate, arrivalTime) {
  const start = zonedToEpoch(zone, schedDate, schedTime)
  const arrival = zonedToEpoch(zone, arrivalDate || schedDate, arrivalTime)
  if (start === null || arrival === null) return null
  return Math.max(0, Math.round((arrival - start) / 60000))
}
