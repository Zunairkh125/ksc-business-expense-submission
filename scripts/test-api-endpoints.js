// ============================================================================
// Endpoint Integration Test for Slack Commands, Interactions & Expenses API
// ============================================================================

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import expenseCommandHandler from '../lib/expenses/slack-command.js'
import interactionsHandler from '../lib/expenses/slack-interactions.js'
import expensesHandler from '../api/expenses.js'
import { createExpenseSessionToken } from '../lib/expenses/session.js'

console.log('🧪 Starting API Endpoints Integration Test Suite...\n')

// Helper to create mock request and response
function createMockReqRes({ method = 'POST', url = '/', headers = {}, body = '', query = {} }) {
  const req = {
    method,
    url,
    headers: { ...headers },
    body: typeof body === 'string' && body.startsWith('{') ? JSON.parse(body) : body,
    query,
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    },
  }

  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v
      return this
    },
    send(data) {
      this.body = data
      return this
    },
    json(data) {
      this.headers['content-type'] = 'application/json'
      this.body = data
      return this
    },
    redirect(url) {
      this.statusCode = 302
      this.redirectUrl = url
      return this
    },
  }

  return { req, res }
}

// ----------------------------------------------------------------------------
// Test 1: Method Not Allowed
// ----------------------------------------------------------------------------
console.log('Test 1: Testing method guards...')
{
  const { req, res } = createMockReqRes({ method: 'GET' })
  await expenseCommandHandler(req, res)
  assert.equal(res.statusCode, 405)
}
{
  const { req, res } = createMockReqRes({ method: 'GET' })
  await interactionsHandler(req, res)
  assert.equal(res.statusCode, 405)
}
console.log('✅ Test 1 Passed: Non-POST methods rejected with 405.\n')

// ----------------------------------------------------------------------------
// Test 2: Signature verification rejection
// ----------------------------------------------------------------------------
console.log('Test 2: Testing Slack signature enforcement on endpoints...')
process.env.SLACK_SIGNING_SECRET = 'test_secret_for_mock'
{
  const { req, res } = createMockReqRes({
    method: 'POST',
    body: 'trigger_id=123.456',
    headers: {
      'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString(),
      'x-slack-signature': 'v0=invalid_sig',
    },
  })
  await expenseCommandHandler(req, res)
  assert.equal(res.statusCode, 401)
}
console.log('✅ Test 2 Passed: Invalid signature correctly rejected with 401.\n')

// ----------------------------------------------------------------------------
// Test 3: Interactions validation error reporting
// ----------------------------------------------------------------------------
console.log('Test 3: Testing interaction validation error handling in modal submission...')
delete process.env.SLACK_SIGNING_SECRET // Disable signature checking for mock payload test

{
  const invalidPayload = {
    type: 'view_submission',
    user: { id: 'U12345', name: 'tester' },
    view: {
      callback_id: 'business_expense_modal',
      state: {
        values: {
          purchase_date_block: { purchase_date: { selected_date: null } },
          amount_block: { amount: { value: 'not-a-number' } },
          business_purpose_block: { business_purpose: { value: '' } },
          category_block: { category: { selected_option: null } },
          receipt_block: { receipt_upload: { files: [] } },
          reimbursement_block: { requires_reimbursement: { selected_option: null } },
        },
      },
    },
  }

  const { req, res } = createMockReqRes({
    method: 'POST',
    body: `payload=${encodeURIComponent(JSON.stringify(invalidPayload))}`,
  })

  await interactionsHandler(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body?.response_action, 'errors')
  assert.ok(res.body?.errors?.purchase_date_block, 'Should have purchase date error')
  assert.ok(res.body?.errors?.amount_block, 'Should have amount error')
  assert.ok(res.body?.errors?.business_purpose_block, 'Should have business purpose error')
  assert.ok(res.body?.errors?.category_block, 'Should have category error')
  assert.ok(res.body?.errors?.receipt_block, 'Should have receipt error')
  assert.ok(res.body?.errors?.reimbursement_block, 'Should have reimbursement error')
}
console.log('✅ Test 3 Passed: Modal validation correctly catches all missing or invalid fields.\n')

// ----------------------------------------------------------------------------
// Test 4: Expenses GET endpoint handles fallback gracefully
// ----------------------------------------------------------------------------
console.log('Test 4: Testing Expenses API GET route...')
{
  const { req, res } = createMockReqRes({ method: 'GET' })
  await expensesHandler(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body?.ok, true)
  assert.ok(Array.isArray(res.body?.expenses), 'Should return expenses array')
}
console.log('✅ Test 4 Passed: Expenses API gracefully returns list format.\n')

// ----------------------------------------------------------------------------
// Test 5: Slack DM Login Code Request Validation
// ----------------------------------------------------------------------------
console.log('Test 5: Testing Slack DM Login Code Request validation...')
{
  // Missing email
  const { req, res } = createMockReqRes({
    method: 'POST',
    query: { route: 'request-code' },
    body: JSON.stringify({ email: '' }),
  })
  await expensesHandler(req, res)
  assert.equal(res.statusCode, 400)
  assert.ok(res.body?.error.includes('valid email'))
}
{
  // Non-POST method
  const { req, res } = createMockReqRes({
    method: 'GET',
    query: { route: 'request-code' },
  })
  await expensesHandler(req, res)
  assert.equal(res.statusCode, 405)
}
console.log('✅ Test 5 Passed: request-code route validates inputs and rejects invalid requests.\n')

// ----------------------------------------------------------------------------
// Test 6: Slack DM Login Code Verify Validation
// ----------------------------------------------------------------------------
console.log('Test 6: Testing Slack DM Login Code Verify validation...')
{
  // Missing code
  const { req, res } = createMockReqRes({
    method: 'POST',
    query: { route: 'verify-code' },
    body: JSON.stringify({ email: 'test@kawaiislimecompany.com', code: '' }),
  })
  await expensesHandler(req, res)
  assert.equal(res.statusCode, 400)
  assert.ok(res.body?.error.includes('required'))
}
{
  // Non-POST method
  const { req, res } = createMockReqRes({
    method: 'GET',
    query: { route: 'verify-code' },
  })
  await expensesHandler(req, res)
  assert.equal(res.statusCode, 405)
}
console.log('✅ Test 6 Passed: verify-code route validates inputs and rejects invalid requests.\n')

// ----------------------------------------------------------------------------
// Test 7: Session Token Authentication on Expenses API
// ----------------------------------------------------------------------------
console.log('Test 7: Testing Bearer Token Session integration...')
const validUser = { username: 'jane@kawaiislimecompany.com', name: 'Jane Doe', role: 'Employee' }
const validToken = createExpenseSessionToken(validUser)
{
  const { req, res } = createMockReqRes({
    method: 'GET',
    headers: { authorization: `Bearer ${validToken}` },
  })
  await expensesHandler(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body?.ok, true)
}
console.log('✅ Test 7 Passed: Valid session Bearer token is accepted.\n')

// ----------------------------------------------------------------------------
// Test 8: Web Form Expense Submit (POST /api/expenses?route=submit)
// ----------------------------------------------------------------------------
console.log('Test 8: Testing Web Form Expense Submit (route=submit)...')
{
  // Missing receipt file
  const { req, res } = createMockReqRes({
    method: 'POST',
    query: { route: 'submit' },
    headers: { authorization: `Bearer ${validToken}` },
    body: JSON.stringify({
      employee_name: 'Jane Doe',
      purchase_date: '2026-11-16',
      amount: '$48.50',
      business_purpose: 'Bought display hooks for Learning Express setup.',
      category: 'Retail Store Supplies',
      requires_reimbursement: 'Yes – I paid personally and need reimbursement',
    }),
  })
  await expensesHandler(req, res)
  assert.equal(res.statusCode, 400)
  assert.ok(res.body?.error.includes('Receipt file upload is required'))
}
{
  // Valid Web Form Submission
  const dummyReceiptBase64 = Buffer.from('mock-receipt-image-content').toString('base64')
  const { req, res } = createMockReqRes({
    method: 'POST',
    query: { route: 'submit' },
    headers: { authorization: `Bearer ${validToken}` },
    body: JSON.stringify({
      employee_name: 'Jane Doe',
      employee_email: 'jane@kawaiislimecompany.com',
      purchase_date: '2026-11-16',
      amount: '$48.50',
      business_purpose: 'Purchased display hooks for Learning Express setup.',
      category: 'Retail Store Supplies',
      requires_reimbursement: 'Yes – I paid personally and need reimbursement',
      receipt_file: {
        name: 'store_receipt.png',
        type: 'image/png',
        data: dummyReceiptBase64,
      },
      additional_notes: 'Paid at register 2.',
    }),
  })
  await expensesHandler(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body?.ok, true)
  assert.equal(res.body?.submission?.employee_name, 'Jane Doe')
  assert.equal(res.body?.submission?.category, 'Retail Store Supplies')
  assert.equal(res.body?.submission?.amount, 48.5)
  assert.equal(res.body?.submission?.requires_reimbursement, true)
}
console.log('✅ Test 8 Passed: Web form submit validates fields and successfully registers submission.\n')

console.log('🎉 ALL 8 ENDPOINT INTEGRATION TESTS PASSED!')
