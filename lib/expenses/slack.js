// ============================================================================
// Kawaii Slime Company - Business Expense & Receipt Submission
// Slack API & Webhook Helpers
// ============================================================================

import crypto from 'node:crypto'
import { clean } from '../finance/db.js'

export async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  if (typeof req.body === 'object' && req.body !== null) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(req.body)) {
      params.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
    }
    return params.toString()
  }
  const chunks = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function verifySlackSignature(rawBody, headers, now = Date.now()) {
  const secret = process.env.SLACK_SIGNING_SECRET
  if (!secret) {
    console.warn('[Slack] SLACK_SIGNING_SECRET is not configured.')
    return false
  }

  const timestamp = String(headers['x-slack-request-timestamp'] || '')
  const signature = String(headers['x-slack-signature'] || '')
  if (!timestamp || !signature) return false

  // 5-minute replay window check
  if (Math.abs(now / 1000 - Number(timestamp)) > 60 * 5) {
    console.warn('[Slack] Timestamp replay check failed.')
    return false
  }

  const sigBase = `v0:${timestamp}:${rawBody}`
  const expected = 'v0=' + crypto.createHmac('sha256', secret).update(sigBase).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.warn('[Slack] Invalid signature verification.')
    return false
  }
  return true
}

export async function slackAPI(method, body = {}, isForm = false) {
  const token = clean(process.env.SLACK_BOT_TOKEN)
  if (!token) throw new Error('SLACK_BOT_TOKEN is not configured.')

  let requestBody
  const headers = { Authorization: `Bearer ${token}` }

  if (isForm) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null && v !== '') {
        params.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
      }
    }
    requestBody = params.toString()
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8'
  } else {
    requestBody = JSON.stringify(body)
    headers['Content-Type'] = 'application/json; charset=utf-8'
  }

  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers,
    body: requestBody,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) {
    const errDetail = (data.response_metadata?.messages || []).join(' ')
    const errMsg = data.error || `Slack ${method} failed with HTTP ${res.status}`
    throw new Error(errDetail ? `${errMsg} (${errDetail})` : errMsg)
  }
  return data
}

export async function openModal(triggerId, view) {
  return slackAPI('views.open', {
    trigger_id: triggerId,
    view,
  })
}

export async function getUserInfo(userId) {
  try {
    const token = clean(process.env.SLACK_BOT_TOKEN)
    if (!token) return { real_name: 'Employee', email: null }

    const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!data.ok || !data.user) {
      return { real_name: 'Employee', email: null }
    }

    const u = data.user
    const real_name = u.real_name || u.profile?.real_name || u.profile?.display_name || u.name || 'Employee'
    const email = u.profile?.email ? String(u.profile.email).toLowerCase() : null
    const display_name = u.profile?.display_name || u.name || real_name

    return { real_name, email, name: u.name, display_name }
  } catch (err) {
    console.error('[Slack] getUserInfo failed:', err.message)
    return { real_name: 'Employee', email: null }
  }
}

export async function lookupUserByEmail(email) {
  const token = clean(process.env.SLACK_BOT_TOKEN)
  if (!token) throw new Error('SLACK_BOT_TOKEN is not configured.')

  const address = String(email || '').trim().toLowerCase()
  const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(address)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) {
    if (data.error === 'users_not_found') {
      return null
    }
    if (data.error === 'missing_scope') {
      throw new Error('Slack app is missing users:read.email scope.')
    }
    throw new Error(data.error || `users.lookupByEmail failed (${res.status})`)
  }

  const user = data.user
  if (!user || user.deleted) return null
  return {
    id: user.id,
    name: user.profile?.real_name || user.real_name || user.name || address,
    email: user.profile?.email ? String(user.profile.email).toLowerCase() : address,
    real_name: user.profile?.real_name || user.real_name || user.name || 'Team Member',
  }
}

export async function openDirectMessage(userId) {
  const data = await slackAPI('conversations.open', { users: userId })
  if (!data.channel?.id) throw new Error('Failed to open DM channel with user.')
  return data.channel.id
}

export async function sendDirectMessage(userId, text) {
  const channelId = await openDirectMessage(userId)
  return slackAPI('chat.postMessage', {
    channel: channelId,
    text,
  })
}

export async function resolveChannelId(channelNameOrId) {
  if (!channelNameOrId) return null
  const cleaned = String(channelNameOrId).trim()
  if (/^[CG][A-Z0-9]{8,}$/.test(cleaned)) {
    return cleaned
  }
  const nameToFind = cleaned.replace(/^#/, '').toLowerCase()
  try {
    const res = await slackAPI('conversations.list', { types: 'public_channel,private_channel', limit: 500 }, true)
    const match = (res.channels || []).find((c) => c.name.toLowerCase() === nameToFind)
    if (match) return match.id
  } catch (err) {
    console.warn('[Slack] Failed to resolve channel by name:', err.message)
  }
  return cleaned
}

export async function postMessage(channel, text, blocks = null) {
  const channelId = await resolveChannelId(channel)
  const payload = { channel: channelId || channel, text }
  if (blocks) payload.blocks = blocks
  return slackAPI('chat.postMessage', payload)
}

export async function downloadSlackFile(urlPrivateDownload) {
  const token = clean(process.env.SLACK_BOT_TOKEN)
  if (!token) throw new Error('SLACK_BOT_TOKEN is not configured.')

  const res = await fetch(urlPrivateDownload, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`Failed to download Slack file from ${urlPrivateDownload} (status ${res.status})`)
  }
  const arrayBuffer = await res.arrayBuffer()
  const contentType = res.headers.get('content-type') || 'application/octet-stream'
  return { buffer: Buffer.from(arrayBuffer), contentType }
}

export async function uploadFileToChannel({ channel, buffer, filename, initialComment = '', title = '' }) {
  const channelId = await resolveChannelId(channel)
  const targetChannel = channelId || channel

  // Try to join the channel in case bot is not yet present
  try {
    await slackAPI('conversations.join', { channel: targetChannel }, true)
  } catch {
    // Ignore join errors (e.g. already in channel or private channel)
  }

  try {
    // Step 1: Request external upload URL
    const uploadInfo = await slackAPI('files.getUploadURLExternal', {
      filename,
      length: buffer.length,
    }, true)

    if (!uploadInfo.upload_url || !uploadInfo.file_id) {
      throw new Error('Slack did not return an external upload URL.')
    }

    // Step 2: Binary POST to the returned upload_url
    const uploadRes = await fetch(uploadInfo.upload_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer,
    })

    if (!uploadRes.ok) {
      throw new Error(`External binary upload failed with status ${uploadRes.status}`)
    }

    // Step 3: Complete upload and share to target channel
    const complete = await slackAPI('files.completeUploadExternal', {
      files: JSON.stringify([{ id: uploadInfo.file_id, title: title || filename }]),
      channel_id: targetChannel,
      initial_comment: initialComment || undefined,
    }, true)

    return { ok: true, file_id: uploadInfo.file_id, complete }
  } catch (err) {
    console.warn(`[Slack] File upload to ${targetChannel} failed:`, err.message)
    // Fallback: post regular message to channel
    const postRes = await postMessage(targetChannel, initialComment)
    return { ok: false, error: err.message, fallback_message: postRes }
  }
}
