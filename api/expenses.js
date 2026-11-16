// ============================================================================
// Kawaii Slime Company - Business Expense & Receipt Submission
// Unified Expense API: Submissions, Slack DM Auth & Slack Webhooks
// ============================================================================

import { admin, jsonError } from '../lib/finance/db.js'
import { downloadSlackFile, lookupUserByEmail, sendDirectMessage } from '../lib/expenses/slack.js'
import { hashLoginCode, verifyLoginCodeHash, createExpenseSessionToken } from '../lib/expenses/session.js'
import slackCommandHandler from './slack/commands/expense.js'
import slackInteractionsHandler from './slack/interactions.js'

export default async function handler(req, res) {
  const route = req.query?.route

  // 1. Route: Slack slash command rewrite
  if (route === 'slack-command' || route === 'command') {
    return slackCommandHandler(req, res)
  }

  // 2. Route: Slack interaction rewrite
  if (route === 'slack-interactions' || route === 'interactions') {
    return slackInteractionsHandler(req, res)
  }

  // 3. Route: Request 4-digit Slack DM login code
  if (route === 'request-code') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Please enter a valid email address.' })
    }

    try {
      // Lookup user in Slack workspace by email
      const slackUser = await lookupUserByEmail(email)
      if (!slackUser) {
        return res.status(404).json({
          error: 'No Slack account found for this email in the Kawaii Slime Company workspace. Please use your Slack account email.',
        })
      }

      // Generate random 4-digit code (1000 - 9999)
      const code = Math.floor(1000 + Math.random() * 9000).toString()
      const codeHash = hashLoginCode(email, code)
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

      // Store challenge in Supabase
      const supabase = admin()
      // Invalidate earlier unused codes for this email
      await supabase
        .from('expense_login_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('email', email)
        .is('used_at', null)

      const { error: insertError } = await supabase.from('expense_login_codes').insert({
        email,
        code_hash: codeHash,
        slack_user_id: slackUser.id,
        slack_user_name: slackUser.real_name || slackUser.name,
        expires_at: expiresAt.toISOString(),
      })

      if (insertError) {
        console.error('[/api/expenses request-code] DB error:', insertError)
        return res.status(500).json({ error: 'Failed to record login code in database.' })
      }

      // Send 4-digit code to Slack DM
      const dmText = `Your KSC Business Expense login code is: *${code}* (valid for 10 minutes).`
      await sendDirectMessage(slackUser.id, dmText)

      return res.status(200).json({
        ok: true,
        email,
        expires_in_seconds: 600,
        message: 'A 4-digit login code has been sent to your Slack direct messages.',
      })
    } catch (err) {
      console.error('[/api/expenses request-code] Error:', err)
      return res.status(500).json({ error: err.message || 'Failed to send verification code.' })
    }
  }

  // 4. Route: Verify 4-digit Slack DM login code
  if (route === 'verify-code') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const email = String(req.body?.email || '').trim().toLowerCase()
    const code = String(req.body?.code || '').trim()

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and 4-digit code are required.' })
    }

    try {
      const supabase = admin()
      const { data: rows, error: selectError } = await supabase
        .from('expense_login_codes')
        .select('*')
        .eq('email', email)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)

      if (selectError) {
        console.error('[/api/expenses verify-code] DB error:', selectError)
        return res.status(500).json({ error: 'Database verification failed.' })
      }

      const challenge = rows && rows[0]
      if (!challenge) {
        return res.status(400).json({
          error: 'Invalid or expired login code. Please request a new 4-digit code.',
        })
      }

      // Check code hash
      const isValid = verifyLoginCodeHash(email, code, challenge.code_hash)
      if (!isValid) {
        return res.status(401).json({
          error: 'Incorrect 4-digit code. Please check your Slack DM and try again.',
        })
      }

      // Mark code as used
      await supabase
        .from('expense_login_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('id', challenge.id)

      // Create signed session token
      const user = {
        username: email,
        name: challenge.slack_user_name || 'Team Member',
        email,
        slack_user_id: challenge.slack_user_id,
        role: 'Employee',
      }
      const token = createExpenseSessionToken(user)

      return res.status(200).json({
        ok: true,
        token,
        user: {
          ...user,
          expense_token: token,
          signedInAt: new Date().toISOString(),
        },
      })
    } catch (err) {
      console.error('[/api/expenses verify-code] Error:', err)
      return res.status(500).json({ error: err.message || 'Verification failed.' })
    }
  }

  // 5. Route: Receipt proxy (view/download Slack uploaded receipt)
  if (route === 'receipt') {
    const id = req.query?.id
    if (!id) return res.status(400).json({ error: 'Missing submission id' })

    try {
      const supabase = admin()
      const { data, error } = await supabase
        .from('expense_submissions')
        .select('*')
        .eq('id', id)
        .single()

      if (error || !data) {
        return res.status(404).json({ error: 'Receipt not found' })
      }

      if (data.receipt_slack_url) {
        try {
          const { buffer, contentType } = await downloadSlackFile(data.receipt_slack_url)
          res.setHeader('Content-Type', contentType)
          res.setHeader('Content-Disposition', `inline; filename="${data.receipt_filename || 'receipt'}"`)
          return res.status(200).send(buffer)
        } catch {
          // If Slack private download fails, redirect to direct URL
          return res.redirect(data.receipt_slack_url)
        }
      }

      return res.status(404).json({ error: 'No receipt URL found on submission' })
    } catch (err) {
      return jsonError(res, err)
    }
  }

  // 6. Default GET: List all expense submissions for Hub Tab
  if (req.method === 'GET') {
    try {
      if ((!process.env.SUPABASE_URL && !process.env.VITE_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_KEY) {
        console.warn('[/api/expenses] Supabase is not configured yet. Returning empty list.')
        return res.status(200).json({ ok: true, expenses: [] })
      }

      const supabase = admin()
      const { data, error } = await supabase
        .from('expense_submissions')
        .select('*')
        .order('purchase_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) {
        console.warn('[/api/expenses] Supabase select error:', error.message)
        return res.status(200).json({ ok: true, expenses: [] })
      }

      return res.status(200).json({
        ok: true,
        expenses: data || [],
      })
    } catch (error) {
      if (/Supabase is not configured/i.test(error.message)) {
        return res.status(200).json({ ok: true, expenses: [] })
      }
      return jsonError(res, error)
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
