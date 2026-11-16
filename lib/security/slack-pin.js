// Email + Slack PIN sign-in, shared by Attendance and Birthday.
//
// 1. The user enters their Slack email.
// 2. A 4-digit PIN is sent to that Slack account by DM.
// 3. The PIN is valid for 10 minutes and can be used once.
// 4. After it is used, the DM is updated to say it was used and when it expires.
//
// Brute-force protection (same for every identifier, whether or not it exists):
// - 5 wrong attempts within 15 minutes lock that email for 15 minutes.
// - The first lock sends a Slack DM to SECURITY_ALERT_SLACK_IDS.
// - Unknown emails and known emails get the same messages and the same cooldown.
//
// PINs are stored as HMAC hashes in the `slack_pin_challenges` table
// (HQ Supabase project). Run supabase/kawaii-hq-slack-pins.sql there first.
import crypto from 'node:crypto'
import { db, must } from '../birthday/supabase.js'
import { env, HttpError } from '../birthday/env.js'
import { slack, slackGet, sendDm } from '../birthday/slack.js'
import { checkLoginLock, recordLoginFailure, clearLoginFailures, lockMessage, notifyLockout } from './login-limiter.js'

const TABLE = 'slack_pin_challenges'
export const PIN_MINUTES = 10
export const PIN_MAX_ATTEMPTS = 3
export const PIN_COOLDOWN_SECONDS = 60
export const SESSION_DAYS_MS = 24 * 60 * 60 * 1000
export const INVALID_LOGIN_MESSAGE = 'Invalid username or PIN.'

const APP_LABEL = { attendance: 'Attendance & Call-Out', birthday: 'Birthday & Anniversary' }

function secret() {
  const value = env('HQ_SESSION_SECRET')
  if (!value) throw new HttpError(500, 'HQ_SESSION_SECRET is not configured in Vercel.')
  return value
}

function hashPin(scope, email, pin) {
  return crypto.createHmac('sha256', secret()).update(`${scope}:${email}:${pin}`).digest('hex')
}

function timeText(date) {
  const zone = env('APP_TIMEZONE', 'Asia/Karachi')
  const text = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(date)
  return zone === 'Asia/Karachi' ? `${text} PKT` : `${text} (${zone})`
}

// Looks up the Slack account for an email. Returns null when there is no such account.
// Needs the users:read.email scope.
async function findSlackUser(email) {
  let data
  try {
    data = await slackGet('users.lookupByEmail', { email })
  } catch (error) {
    if (error.slackError === 'users_not_found') return null
    if (error.slackError === 'missing_scope') throw new HttpError(500, 'The Slack app needs the users:read.email scope.')
    throw error
  }
  const user = data.user
  if (!user || user.deleted) return null
  return { id: user.id, name: user.profile?.real_name || user.real_name || user.name || email }
}

// Sends a new PIN to the Slack account that owns `email`.
// For an unknown email it returns the same response but sends nothing.
export async function requestSlackPin({ scope, email }) {
  const address = String(email || '').trim().toLowerCase()
  if (!address) throw new HttpError(400, 'Email is required.')

  const lock = await checkLoginLock(db(), address)
  if (lock.locked) throw new HttpError(429, lockMessage(lock.retryAfterSeconds))

  const last = must(
    await db().from(TABLE).select('created_at').eq('scope', scope).eq('email', address)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    'Could not check PIN history',
  )
  if (last && Date.now() - Date.parse(last.created_at) < PIN_COOLDOWN_SECONDS * 1000) {
    throw new HttpError(429, `Please wait ${PIN_COOLDOWN_SECONDS} seconds before requesting another PIN.`)
  }

  const slackUser = await findSlackUser(address)
  const pin = crypto.randomInt(0, 10000).toString().padStart(4, '0')
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + PIN_MINUTES * 60 * 1000)
  const response = { sent: true, expires_in_seconds: PIN_MINUTES * 60, cooldown_seconds: PIN_COOLDOWN_SECONDS }

  // Earlier unused PINs for this email stop working.
  must(
    await db().from(TABLE).update({ used_at: createdAt.toISOString(), status: 'replaced' })
      .eq('scope', scope).eq('email', address).is('used_at', null),
    'Could not reset old PINs',
  )

  const row = must(
    await db().from(TABLE).insert({
      scope,
      email: address,
      slack_user_id: slackUser?.id || 'none',
      slack_name: slackUser?.name || null,
      pin_hash: hashPin(scope, address, pin),
      created_at: createdAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: slackUser ? 'open' : 'no_account',
    }).select().single(),
    'Could not save PIN',
  )

  // Unknown email: nothing is sent, but the response looks the same.
  if (!slackUser) return response

  const sent = await sendDm(
    slackUser.id,
    `🔐 *Verification PIN*\n\nYour PIN is: *\`${pin}\`*\n\nThis PIN expires in ${PIN_MINUTES} minutes (at ${timeText(expiresAt)}). It can be used only once. If you did not request this, please contact HR.`,
  )
  must(
    await db().from(TABLE).update({ dm_channel: sent.channel, dm_ts: sent.ts }).eq('id', row.id),
    'Could not save PIN message details',
  )
  return response
}

// Checks a PIN. On success marks it used, clears failures and updates the Slack DM.
// Returns { email, name, slackUserId }.
export async function verifySlackPin({ scope, email, pin }) {
  const address = String(email || '').trim().toLowerCase()
  const code = String(pin || '').trim()
  const limiter = db()

  const lock = await checkLoginLock(limiter, address)
  if (lock.locked) throw new HttpError(429, lockMessage(lock.retryAfterSeconds))

  // Every failed attempt is counted, including unknown emails and expired PINs.
  const fail = async () => {
    const result = await recordLoginFailure(limiter, address)
    if (result.locked) {
      await notifyLockout({ app: APP_LABEL[scope] || scope, identifier: address })
      throw new HttpError(429, lockMessage(result.retryAfterSeconds))
    }
    throw new HttpError(401, INVALID_LOGIN_MESSAGE)
  }

  if (!/^\d{4}$/.test(code)) return fail()

  const row = must(
    await limiter.from(TABLE).select('*')
      .eq('scope', scope).eq('email', address).eq('status', 'open').is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    'Could not load PIN',
  )
  if (!row) return fail()

  if (row.attempts >= PIN_MAX_ATTEMPTS) {
    await limiter.from(TABLE).update({ status: 'locked', used_at: new Date().toISOString() }).eq('id', row.id)
    return fail()
  }

  const given = Buffer.from(hashPin(scope, address, code))
  const stored = Buffer.from(row.pin_hash)
  const ok = given.length === stored.length && crypto.timingSafeEqual(given, stored)
  if (!ok) {
    const attempts = row.attempts + 1
    const left = PIN_MAX_ATTEMPTS - attempts
    await limiter.from(TABLE).update({ attempts, ...(left <= 0 ? { status: 'locked', used_at: new Date().toISOString() } : {}) }).eq('id', row.id)
    return fail()
  }

  const usedAt = new Date()
  const updated = must(
    await limiter.from(TABLE).update({ used_at: usedAt.toISOString(), status: 'used' })
      .eq('id', row.id).is('used_at', null).select(),
    'Could not mark PIN as used',
  )
  if (!updated.length) return fail()

  await clearLoginFailures(limiter, address)
  await markDmUsed(row, usedAt).catch((error) => console.error('PIN DM update failed:', error?.message || error))

  return { email: address, name: row.slack_name, slackUserId: row.slack_user_id }
}

// Replaces the PIN message in Slack with a "used" notice. The expiry shown is 24 hours after use.
async function markDmUsed(row, usedAt) {
  if (!row.dm_channel || !row.dm_ts) return
  const expires = new Date(usedAt.getTime() + SESSION_DAYS_MS)
  await slack('chat.update', {
    channel: row.dm_channel,
    ts: row.dm_ts,
    text: `🔒 *This PIN has been used.*\n\nUsed on ${timeText(usedAt)}.\nThis PIN expires on ${timeText(expires)}.`,
  })
}
