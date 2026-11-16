// ============================================================================
// Kawaii Slime Company - Business Expense & Receipt Submission
// Slack Slash Command: /expense
// ============================================================================

import { readRawBody, verifySlackSignature, getUserInfo, openModal } from './slack.js'
import { buildExpenseModal } from './expense-modal.js'

export default async function handleSlackCommand(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const rawBody = await readRawBody(req)

    // Verify Slack request signature (skip if SLACK_SIGNING_SECRET not configured)
    if (process.env.SLACK_SIGNING_SECRET && !verifySlackSignature(rawBody, req.headers)) {
      console.warn('[Slack Command /expense] Slack signature verification failed.')
      return res.status(401).send('Unauthorized: Invalid Slack request signature.')
    }

    const params = new URLSearchParams(rawBody)
    const triggerId = params.get('trigger_id')
    const userId = params.get('user_id')

    if (!triggerId) {
      return res.status(400).send('Missing trigger_id.')
    }

    // Automatically retrieve user info for Employee field
    const userInfo = userId ? await getUserInfo(userId) : { real_name: 'Employee', email: null }
    const modalView = buildExpenseModal(userId, userInfo)

    await openModal(triggerId, modalView)
    return res.status(200).send('')
  } catch (error) {
    console.error('[Slack Command /expense] Error opening expense modal:', error)
    return res.status(500).send('Failed to open Business Expense modal.')
  }
}
