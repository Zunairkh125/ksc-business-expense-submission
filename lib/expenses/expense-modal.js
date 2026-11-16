// ============================================================================
// Kawaii Slime Company - Business Expense & Receipt Submission
// Slack Block Kit Modal Definition (/expense)
// ============================================================================

export const EXPENSE_CATEGORIES = [
  'Office Supplies',
  'Inventory / Production Supplies',
  'Shipping & Postage',
  'Marketing',
  'Travel',
  'Meals',
  'Software / Subscriptions',
  'Equipment',
  'Retail Store Supplies',
  'Maintenance',
  'Other',
]

export const REIMBURSEMENT_OPTIONS = [
  'Yes – I paid personally and need reimbursement',
  'No – Company card or company account was used',
]

/**
 * Builds the Slack modal view for /expense submission.
 * Note: Slack enforces a strict 24-character maximum on modal title.text,
 * so 'Business Expense' (16 chars) is used in the modal frame, with the full
 * 'Business Expense & Receipt Submission' rendered in the primary header block.
 */
export function buildExpenseModal(userId, userInfo = {}) {
  const today = new Date().toISOString().slice(0, 10)
  const employeeName = userInfo.real_name || userInfo.name || 'Team Member'
  const employeeEmail = userInfo.email || ''

  return {
    type: 'modal',
    callback_id: 'business_expense_modal',
    title: {
      type: 'plain_text',
      text: 'Business Expense',
      emoji: true,
    },
    submit: {
      type: 'plain_text',
      text: 'Submit',
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
      emoji: true,
    },
    private_metadata: JSON.stringify({
      userId,
      employeeName,
      employeeEmail,
    }),
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'Business Expense & Receipt Submission',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Use this form for all business purchases—whether you used a personal payment method (and need reimbursement) or a company credit card.',
        },
      },
      {
        type: 'section',
        block_id: 'employee_section',
        text: {
          type: 'mrkdwn',
          text: `*Employee:* ${employeeName} (<@${userId}>)`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'input',
        block_id: 'purchase_date_block',
        element: {
          type: 'datepicker',
          action_id: 'purchase_date',
          initial_date: today,
          placeholder: {
            type: 'plain_text',
            text: 'Select purchase date',
            emoji: true,
          },
        },
        label: {
          type: 'plain_text',
          text: 'Date of Purchase',
          emoji: true,
        },
      },
      {
        type: 'input',
        block_id: 'amount_block',
        element: {
          type: 'plain_text_input',
          action_id: 'amount',
          placeholder: {
            type: 'plain_text',
            text: '$XX.XX',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Amount',
          emoji: true,
        },
        hint: {
          type: 'plain_text',
          text: 'Currency input formatted as $XX.XX (e.g. $45.50)',
        },
      },
      {
        type: 'input',
        block_id: 'business_purpose_block',
        element: {
          type: 'plain_text_input',
          action_id: 'business_purpose',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'Briefly describe what was purchased and why. Example: Purchased display hooks for Learning Express setup.',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Business Purpose',
          emoji: true,
        },
        hint: {
          type: 'plain_text',
          text: 'Briefly describe what was purchased and why. Example: Purchased display hooks for Learning Express setup.',
        },
      },
      {
        type: 'input',
        block_id: 'category_block',
        element: {
          type: 'static_select',
          action_id: 'category',
          placeholder: {
            type: 'plain_text',
            text: 'Select expense category',
            emoji: true,
          },
          options: EXPENSE_CATEGORIES.map((cat) => ({
            text: {
              type: 'plain_text',
              text: cat,
              emoji: true,
            },
            value: cat,
          })),
        },
        label: {
          type: 'plain_text',
          text: 'Expense Category',
          emoji: true,
        },
      },
      {
        type: 'input',
        block_id: 'receipt_block',
        optional: false,
        element: {
          type: 'file_input',
          action_id: 'receipt_upload',
          max_files: 1,
        },
        label: {
          type: 'plain_text',
          text: 'Upload Receipt',
          emoji: true,
        },
      },
      {
        type: 'input',
        block_id: 'reimbursement_block',
        element: {
          type: 'static_select',
          action_id: 'requires_reimbursement',
          placeholder: {
            type: 'plain_text',
            text: 'Select reimbursement status',
            emoji: true,
          },
          options: REIMBURSEMENT_OPTIONS.map((opt) => ({
            text: {
              type: 'plain_text',
              text: opt,
              emoji: true,
            },
            value: opt,
          })),
        },
        label: {
          type: 'plain_text',
          text: 'Does this purchase require reimbursement?',
          emoji: true,
        },
      },
      {
        type: 'input',
        block_id: 'additional_notes_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'additional_notes',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'Additional notes, vendor, or order confirmation (optional)',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Additional Notes',
          emoji: true,
        },
      },
    ],
  }
}
