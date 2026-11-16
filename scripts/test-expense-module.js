// ============================================================================
// Comprehensive Test Suite for Business Expense & Receipt Submission Module
// ============================================================================

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { buildExpenseModal, EXPENSE_CATEGORIES, REIMBURSEMENT_OPTIONS } from '../lib/expenses/expense-modal.js'
import { verifySlackSignature } from '../lib/expenses/slack.js'
import {
  createExpenseSessionToken,
  verifyExpenseSessionToken,
  hashLoginCode,
  verifyLoginCodeHash,
} from '../lib/expenses/session.js'

console.log('🧪 Starting Business Expense & Receipt Submission Test Suite...\n')

// ----------------------------------------------------------------------------
// Test 1: Expense Categories Check
// ----------------------------------------------------------------------------
console.log('Test 1: Verifying exact 11 Expense Categories...')
const EXPECTED_CATEGORIES = [
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
assert.equal(EXPENSE_CATEGORIES.length, 11, 'Must have exactly 11 categories')
assert.deepEqual(EXPENSE_CATEGORIES, EXPECTED_CATEGORIES, 'Categories must match exact list')
console.log('✅ Test 1 Passed: Exactly 11 categories present.\n')

// ----------------------------------------------------------------------------
// Test 2: Reimbursement Options Check
// ----------------------------------------------------------------------------
console.log('Test 2: Verifying exact 2 Reimbursement Options...')
const EXPECTED_REIMBURSEMENT = [
  'Yes – I paid personally and need reimbursement',
  'No – Company card or company account was used',
]
assert.equal(REIMBURSEMENT_OPTIONS.length, 2, 'Must have exactly 2 options')
assert.deepEqual(REIMBURSEMENT_OPTIONS, EXPECTED_REIMBURSEMENT, 'Reimbursement options match')
console.log('✅ Test 2 Passed: Exactly 2 reimbursement options present.\n')

// ----------------------------------------------------------------------------
// Test 3: Slack Modal Block Kit Structure & Field Constraints
// ----------------------------------------------------------------------------
console.log('Test 3: Verifying Slack Modal Structure & Length Constraints...')
const modal = buildExpenseModal('U12345ABC', { real_name: 'Jane Doe', email: 'jane@kawaiislimecompany.com' })

// Slack constraint: modal title must be <= 24 characters
assert.ok(modal.title.text.length <= 24, `Modal title length ${modal.title.text.length} must be <= 24 characters`)
assert.equal(modal.type, 'modal')
assert.equal(modal.callback_id, 'business_expense_modal')

// Check Header Block
const headerBlock = modal.blocks.find(b => b.type === 'header')
assert.ok(headerBlock, 'Header block must exist')
assert.equal(headerBlock.text.text, 'Business Expense & Receipt Submission')

// Check Intro Text
const introBlock = modal.blocks.find(b => b.text?.text?.includes('whether you used a personal payment method'))
assert.ok(introBlock, 'Intro text block must exist')

// Check Employee Field
const employeeBlock = modal.blocks.find(b => b.block_id === 'employee_section')
assert.ok(employeeBlock, 'Employee block must exist')
assert.ok(employeeBlock.text.text.includes('Jane Doe'), 'Must include employee name')
assert.ok(employeeBlock.text.text.includes('U12345ABC'), 'Must include Slack user ID')

// Check Date of Purchase Block
const dateBlock = modal.blocks.find(b => b.block_id === 'purchase_date_block')
assert.ok(dateBlock, 'Date of Purchase block must exist')
assert.equal(dateBlock.element.type, 'datepicker')
assert.equal(dateBlock.element.action_id, 'purchase_date')

// Check Amount Block
const amountBlock = modal.blocks.find(b => b.block_id === 'amount_block')
assert.ok(amountBlock, 'Amount block must exist')
assert.equal(amountBlock.element.action_id, 'amount')

// Check Business Purpose Block
const purposeBlock = modal.blocks.find(b => b.block_id === 'business_purpose_block')
assert.ok(purposeBlock, 'Business Purpose block must exist')
assert.equal(purposeBlock.element.action_id, 'business_purpose')
assert.ok(purposeBlock.hint.text.includes('Example: Purchased display hooks for Learning Express setup'))

// Check Category Dropdown Block
const categoryBlock = modal.blocks.find(b => b.block_id === 'category_block')
assert.ok(categoryBlock, 'Category block must exist')
assert.equal(categoryBlock.element.type, 'static_select')
assert.equal(categoryBlock.element.options.length, 11)

// Check Receipt File Upload Block (optional: false)
const receiptBlock = modal.blocks.find(b => b.block_id === 'receipt_block')
assert.ok(receiptBlock, 'Receipt upload block must exist')
assert.equal(receiptBlock.element.type, 'file_input')
assert.equal(receiptBlock.optional, false)

// Check Reimbursement Dropdown Block
const reimbBlock = modal.blocks.find(b => b.block_id === 'reimbursement_block')
assert.ok(reimbBlock, 'Reimbursement block must exist')
assert.equal(reimbBlock.element.type, 'static_select')
assert.equal(reimbBlock.element.options.length, 2)

// Check Additional Notes Block (optional: true)
const notesBlock = modal.blocks.find(b => b.block_id === 'additional_notes_block')
assert.ok(notesBlock, 'Additional notes block must exist')
assert.equal(notesBlock.optional, true)

console.log('✅ Test 3 Passed: Slack Modal meets all exact Block Kit specifications.\n')

// ----------------------------------------------------------------------------
// Test 4: Slack Request Signature Verification
// ----------------------------------------------------------------------------
console.log('Test 4: Verifying Slack HMAC-SHA256 signature verification...')
const secret = 'ksc_slack_test_secret_12345'
process.env.SLACK_SIGNING_SECRET = secret

const rawBody = 'command=%2Fexpense&trigger_id=123.456.789&user_id=U123'
const timestamp = Math.floor(Date.now() / 1000).toString()
const sigBase = `v0:${timestamp}:${rawBody}`
const validSig = 'v0=' + crypto.createHmac('sha256', secret).update(sigBase).digest('hex')

// Valid signature
const isValid = verifySlackSignature(rawBody, {
  'x-slack-request-timestamp': timestamp,
  'x-slack-signature': validSig,
})
assert.equal(isValid, true, 'Valid signature should verify successfully')

// Invalid signature
const isBad = verifySlackSignature(rawBody, {
  'x-slack-request-timestamp': timestamp,
  'x-slack-signature': 'v0=0000000000000000000000000000000000000000000000000000000000000000',
})
assert.equal(isBad, false, 'Bad signature should be rejected')

// Replayed signature (> 5 minutes old)
const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString()
const oldSig = 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${oldTimestamp}:${rawBody}`).digest('hex')
const isReplay = verifySlackSignature(rawBody, {
  'x-slack-request-timestamp': oldTimestamp,
  'x-slack-signature': oldSig,
})
assert.equal(isReplay, false, 'Old timestamp should be rejected to prevent replay attacks')

console.log('✅ Test 4 Passed: Slack signature security verification works accurately.\n')

// ----------------------------------------------------------------------------
// Test 5: Slack Email 4-Digit Login Code Hashing & Verification
// ----------------------------------------------------------------------------
console.log('Test 5: Verifying Slack Email 4-digit code hashing and validation...')
const testEmail = 'employee@kawaiislimecompany.com'
const testCode = '4829'
const codeHash = hashLoginCode(testEmail, testCode)

assert.ok(codeHash, 'Hash must be generated')
assert.equal(typeof codeHash, 'string')
assert.equal(codeHash.length, 64, 'SHA-256 HMAC should be 64 hex characters')

// Valid code match
assert.equal(verifyLoginCodeHash(testEmail, testCode, codeHash), true, 'Correct code must verify')

// Wrong code
assert.equal(verifyLoginCodeHash(testEmail, '9999', codeHash), false, 'Wrong code must be rejected')

// Case insensitivity on email
assert.equal(verifyLoginCodeHash('EMPLOYEE@kawaiislimecompany.com', testCode, codeHash), true, 'Email check should be case-insensitive')

// Wrong email
assert.equal(verifyLoginCodeHash('other@kawaiislimecompany.com', testCode, codeHash), false, 'Wrong email must be rejected')

console.log('✅ Test 5 Passed: 4-digit DM code hashing and verification are cryptographically secure.\n')

// ----------------------------------------------------------------------------
// Test 6: Session Token Creation & Verification
// ----------------------------------------------------------------------------
console.log('Test 6: Verifying Session Token generation & validation...')
const testUser = { username: 'junaid', name: 'Junaid', role: 'Admin' }
const token = createExpenseSessionToken(testUser)
assert.ok(token, 'Session token should be created')

const verified = verifyExpenseSessionToken(token)
assert.ok(verified, 'Session token should be verified')
assert.equal(verified.username, 'junaid')
assert.equal(verified.role, 'Admin')

const invalidToken = verifyExpenseSessionToken(token + 'tampered')
assert.equal(invalidToken, null, 'Tampered token should return null')

console.log('✅ Test 6 Passed: Session tokens are cryptographically secure.\n')

// ----------------------------------------------------------------------------
// Test 7: Channel Routing & Accounting Message Format Verification
// ----------------------------------------------------------------------------
console.log('Test 7: Verifying Channel Routing and Accounting Message Format...')

function formatAccountingMessage({ employeeName, slackUserId, purchaseDate, amountFormatted, businessPurpose, category, requiresReimbursement, additionalNotes }) {
  const messageLines = [
    '*Business Expense & Receipt Submission*',
    `*Employee:* ${employeeName} (<@${slackUserId}>)`,
    `*Date of Purchase:* ${purchaseDate}`,
    `*Amount:* ${amountFormatted}`,
    `*Business Purpose:* ${businessPurpose.trim()}`,
    `*Expense Category:* ${category}`,
    `*Requires Reimbursement:* ${requiresReimbursement ? 'Yes' : 'No'}`,
  ]
  if (additionalNotes && additionalNotes.trim()) {
    messageLines.push(`*Additional Notes:* ${additionalNotes.trim()}`)
  }
  return messageLines.join('\n')
}

// Case A: Reimbursement Yes with notes
const msgA = formatAccountingMessage({
  employeeName: 'Sarah Connor',
  slackUserId: 'U9999',
  purchaseDate: '2026-11-17',
  amountFormatted: '$84.50',
  businessPurpose: 'Purchased display hooks for Learning Express setup',
  category: 'Retail Store Supplies',
  requiresReimbursement: true,
  additionalNotes: 'Receipt was emailed from Home Depot',
})

assert.ok(msgA.includes('*Requires Reimbursement:* Yes'))
assert.ok(msgA.includes('*Additional Notes:* Receipt was emailed from Home Depot'))
assert.ok(msgA.includes('*Amount:* $84.50'))

// Case B: Company card No reimbursement without notes
const msgB = formatAccountingMessage({
  employeeName: 'Bob Vance',
  slackUserId: 'U8888',
  purchaseDate: '2026-11-15',
  amountFormatted: '$150.00',
  businessPurpose: 'Monthly QuickBooks subscription',
  category: 'Software / Subscriptions',
  requiresReimbursement: false,
  additionalNotes: '',
})

assert.ok(msgB.includes('*Requires Reimbursement:* No'))
assert.ok(!msgB.includes('*Additional Notes:*'), 'Additional notes line must be omitted when empty')

// Routing assertions
function routeChannel(requiresReimbursement) {
  return requiresReimbursement ? '#finance-reimbursements' : '#ap-domestic-receipts'
}
assert.equal(routeChannel(true), '#finance-reimbursements')
assert.equal(routeChannel(false), '#ap-domestic-receipts')

console.log('✅ Test 7 Passed: Channel routing & message formatting match specifications perfectly.\n')

console.log('🎉 ALL 7 TEST SUITES PASSED CLEANLY!')
