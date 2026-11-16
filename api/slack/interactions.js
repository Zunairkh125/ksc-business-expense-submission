// ============================================================================
// Kawaii Slime Company - Business Expense & Receipt Submission
// Slack Interactive Components Endpoint (Modal Submissions)
// ============================================================================

import { readRawBody, verifySlackSignature, downloadSlackFile, uploadFileToChannel, postMessage } from '../../lib/expenses/slack.js'
import { admin } from '../../lib/finance/db.js'

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const rawBody = await readRawBody(req)

    // Verify Slack signature
    if (process.env.SLACK_SIGNING_SECRET && !verifySlackSignature(rawBody, req.headers)) {
      console.warn('[/api/slack/interactions] Slack signature verification failed.')
      return res.status(401).send('Unauthorized: Invalid Slack request signature.')
    }

    const params = new URLSearchParams(rawBody)
    const payloadStr = params.get('payload')
    if (!payloadStr) {
      return res.status(400).send('Missing payload parameter.')
    }

    const payload = JSON.parse(payloadStr)

    // Handle view_submission
    if (payload.type === 'view_submission') {
      const view = payload.view
      if (view.callback_id === 'business_expense_modal') {
        const values = view.state?.values || {}
        const errors = {}

        // 1. Employee metadata
        let metadata = {}
        try {
          metadata = JSON.parse(view.private_metadata || '{}')
        } catch {
          metadata = {}
        }
        const slackUserId = payload.user?.id || metadata.userId || 'Unknown'
        const employeeName = metadata.employeeName || payload.user?.name || 'Employee'
        const employeeEmail = metadata.employeeEmail || null

        // 2. Date of Purchase
        const purchaseDate = values.purchase_date_block?.purchase_date?.selected_date
        if (!purchaseDate) {
          errors.purchase_date_block = 'Please select a purchase date.'
        }

        // 3. Amount ($XX.XX)
        const amountRaw = values.amount_block?.amount?.value || ''
        const cleanAmount = String(amountRaw).replace(/[\$,]/g, '').trim()
        const amountNum = parseFloat(cleanAmount)
        if (isNaN(amountNum) || amountNum <= 0) {
          errors.amount_block = 'Please enter a valid amount formatted as $XX.XX (e.g. $45.50).'
        }
        const amountFormatted = `$${amountNum.toFixed(2)}`

        // 4. Business Purpose
        const businessPurpose = values.business_purpose_block?.business_purpose?.value || ''
        if (!businessPurpose.trim()) {
          errors.business_purpose_block = 'Briefly describe what was purchased and why.'
        }

        // 5. Expense Category
        const category = values.category_block?.category?.selected_option?.value
        if (!category) {
          errors.category_block = 'Please select an expense category.'
        }

        // 6. Upload Receipt (required)
        const files = values.receipt_block?.receipt_upload?.files || []
        if (!files || files.length === 0) {
          errors.receipt_block = 'Please upload a receipt.'
        }

        // 7. Does this purchase require reimbursement?
        const reimbursementChoice = values.reimbursement_block?.requires_reimbursement?.selected_option?.value
        if (!reimbursementChoice) {
          errors.reimbursement_block = 'Please select whether this purchase requires reimbursement.'
        }
        const requiresReimbursement = String(reimbursementChoice || '').startsWith('Yes')

        // 8. Additional Notes (optional)
        const additionalNotes = values.additional_notes_block?.additional_notes?.value?.trim() || ''

        // Return validation errors if any
        if (Object.keys(errors).length > 0) {
          return res.status(200).json({
            response_action: 'errors',
            errors,
          })
        }

        // --- Processing valid submission ---
        const file = files[0] || {}
        const filename = file.name || 'receipt'
        const fileId = file.id || null
        const slackFileUrl = file.permalink || file.url_private || ''

        // Channel routing:
        // "Yes – I paid personally and need reimbursement" -> #finance-reimbursements
        // "No – Company card or company account was used" -> #ap-domestic-receipts
        const reimbursementChannel = process.env.SLACK_REIMBURSEMENT_CHANNEL_ID || process.env.SLACK_CHANNEL_REIMBURSEMENTS || '#finance-reimbursements'
        const apReceiptsChannel = process.env.SLACK_AP_RECEIPTS_CHANNEL_ID || process.env.SLACK_CHANNEL_AP_RECEIPTS || '#ap-domestic-receipts'
        const targetChannel = requiresReimbursement ? reimbursementChannel : apReceiptsChannel
        const routedChannelName = requiresReimbursement ? '#finance-reimbursements' : '#ap-domestic-receipts'

        // Construct exact accounting Slack message format:
        // (Include Additional Notes: <Notes> only if provided.)
        const messageLines = [
          '*Business Expense & Receipt Submission*',
          `*Employee:* ${employeeName} (<@${slackUserId}>)`,
          `*Date of Purchase:* ${purchaseDate}`,
          `*Amount:* ${amountFormatted}`,
          `*Business Purpose:* ${businessPurpose.trim()}`,
          `*Expense Category:* ${category}`,
          `*Requires Reimbursement:* ${requiresReimbursement ? 'Yes' : 'No'}`,
        ]
        if (additionalNotes) {
          messageLines.push(`*Additional Notes:* ${additionalNotes}`)
        }
        const accountingMessage = messageLines.join('\n')

        // Post to the target Slack channel with receipt attached
        let uploadResult = null
        try {
          if (file.url_private_download) {
            const { buffer } = await downloadSlackFile(file.url_private_download)
            uploadResult = await uploadFileToChannel({
              channel: targetChannel,
              buffer,
              filename,
              initialComment: accountingMessage,
              title: `${employeeName} - ${category} Receipt (${amountFormatted})`,
            })
          } else {
            await postMessage(targetChannel, `${accountingMessage}\n*Receipt:* ${slackFileUrl}`)
          }
        } catch (postErr) {
          console.error('[Slack Interactions] Failed to post to Slack channel:', postErr)
          // Fallback simple message
          try {
            await postMessage(targetChannel, `${accountingMessage}\n*Receipt:* ${slackFileUrl}`)
          } catch {
            // Ignore secondary error
          }
        }

        // Save submission record to Supabase
        try {
          const supabase = admin()
          const insertPayload = {
            slack_user_id: slackUserId,
            employee_name: employeeName,
            employee_email: employeeEmail,
            purchase_date: purchaseDate,
            amount: amountNum,
            business_purpose: businessPurpose.trim(),
            category,
            requires_reimbursement: requiresReimbursement,
            receipt_filename: filename,
            receipt_slack_url: slackFileUrl,
            receipt_file_id: fileId,
            additional_notes: additionalNotes || null,
            routed_channel_name: routedChannelName,
            routed_channel_id: targetChannel,
            status: 'pending',
          }

          const { error: dbError } = await supabase
            .from('expense_submissions')
            .insert(insertPayload)

          if (dbError) {
            console.error('[Slack Interactions] Supabase insert error:', dbError)
            // Retry without optional columns if schema is minimal
            if (dbError.code === '42703') {
              const fallbackPayload = {
                slack_user_id: slackUserId,
                employee_name: employeeName,
                purchase_date: purchaseDate,
                amount: amountNum,
                business_purpose: businessPurpose.trim(),
                category,
                requires_reimbursement: requiresReimbursement,
                receipt_filename: filename,
                receipt_slack_url: slackFileUrl,
                additional_notes: additionalNotes || null,
              }
              await supabase.from('expense_submissions').insert(fallbackPayload)
            }
          }
        } catch (dbErr) {
          console.error('[Slack Interactions] Supabase connection error:', dbErr)
        }

        // Successfully close the modal
        return res.status(200).json({ response_action: 'clear' })
      }
    }

    return res.status(200).send('')
  } catch (error) {
    console.error('[/api/slack/interactions] Error processing interaction:', error)
    return res.status(500).send('Internal server error.')
  }
}
