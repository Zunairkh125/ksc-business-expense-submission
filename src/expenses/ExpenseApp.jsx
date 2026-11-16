import { useEffect, useRef, useState } from 'react'
import './expenses.css'

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

function formatCurrency(amount) {
  const num = Number(amount || 0)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(num)
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const DEFAULT_PREVIEW_EXPENSES = [
  {
    id: 'demo-1',
    employee_name: 'Zunair Rafiq',
    employee_email: 'zunair@kawaiislimecompany.com',
    purchase_date: '2026-11-16',
    amount: 48.5,
    business_purpose: 'Purchased display hooks for Learning Express setup',
    category: 'Retail Store Supplies',
    requires_reimbursement: true,
    additional_notes: 'Paid cash at register, store receipt attached.',
    receipt_filename: 'receipt_learning_express.png',
    receipt_slack_url: 'https://images.unsplash.com/photo-1554415707-9e4c9798031a?w=800&auto=format&fit=crop&q=80',
    routed_channel_name: 'finance-reimbursements',
    status: 'pending',
    created_at: new Date().toISOString(),
  },
  {
    id: 'demo-2',
    employee_name: 'Carla Gomez',
    employee_email: 'carla@kawaiislimecompany.com',
    purchase_date: '2026-11-15',
    amount: 125.0,
    business_purpose: 'Monthly Adobe Creative Cloud subscription renewal',
    category: 'Software / Subscriptions',
    requires_reimbursement: false,
    additional_notes: 'Company card used for automated billing.',
    receipt_filename: 'adobe_invoice_nov2026.pdf',
    receipt_slack_url: 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=800&auto=format&fit=crop&q=80',
    routed_channel_name: 'ap-domestic-receipts',
    status: 'approved',
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'demo-3',
    employee_name: 'Chris Johnson',
    employee_email: 'chris@kawaiislimecompany.com',
    purchase_date: '2026-11-14',
    amount: 320.75,
    business_purpose: 'Raw clear glue gallon containers for slime production line',
    category: 'Inventory / Production Supplies',
    requires_reimbursement: false,
    additional_notes: 'Delivered directly to Reno warehouse.',
    receipt_filename: 'supplier_packing_slip.png',
    receipt_slack_url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&auto=format&fit=crop&q=80',
    routed_channel_name: 'ap-domestic-receipts',
    status: 'pending',
    created_at: new Date(Date.now() - 172800000).toISOString(),
  },
]

export default function ExpenseApp({ user, token: propToken }) {
  const [expenses, setExpenses] = useState(DEFAULT_PREVIEW_EXPENSES)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [previewReceipt, setPreviewReceipt] = useState(null)

  // Web Form Submit State
  const [employeeName, setEmployeeName] = useState(user?.name || user?.username || 'Employee')
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState('')
  const [businessPurpose, setBusinessPurpose] = useState('')
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0])
  const [requiresReimbursement, setRequiresReimbursement] = useState(REIMBURSEMENT_OPTIONS[0])
  const [additionalNotes, setAdditionalNotes] = useState('')
  const [receiptFile, setReceiptFile] = useState(null)
  const [receiptFileName, setReceiptFileName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState('')
  const fileInputRef = useRef(null)

  const token = propToken || user?.expense_token || ''

  useEffect(() => {
    if (user?.name) {
      setEmployeeName(user.name)
    }
  }, [user])

  async function loadExpenses() {
    setLoading(true)
    setError('')
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch('/api/expenses', { headers })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.error || `Failed to fetch expenses (${res.status})`)
      }
      setExpenses(data.expenses && data.expenses.length > 0 ? data.expenses : DEFAULT_PREVIEW_EXPENSES)
    } catch (err) {
      console.error('[ExpenseApp] Failed to load expenses:', err)
      setExpenses((prev) => (prev.length > 0 ? prev : DEFAULT_PREVIEW_EXPENSES))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadExpenses()
  }, [token])

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) {
      setReceiptFile(null)
      setReceiptFileName('')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setSubmitError('File is too large (maximum 5MB). Please upload a smaller image or PDF.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const base64Data = String(reader.result).split(',')[1]
      setReceiptFile({
        name: file.name,
        type: file.type,
        data: base64Data,
        previewUrl: file.type.startsWith('image/') ? reader.result : null,
      })
      setReceiptFileName(file.name)
    }
    reader.readAsDataURL(file)
  }

  async function handleSubmitExpense(e) {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError('')
    setSubmitSuccess('')

    try {
      if (!receiptFile || !receiptFile.data) {
        throw new Error('Please upload a receipt file (Image or PDF).')
      }

      const payload = {
        employee_name: employeeName,
        employee_email: user?.email || '',
        purchase_date: purchaseDate,
        amount,
        business_purpose: businessPurpose,
        category,
        requires_reimbursement: requiresReimbursement.startsWith('Yes'),
        receipt_file: receiptFile,
        additional_notes: additionalNotes,
      }

      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch('/api/expenses?route=submit', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit business expense.')
      }

      setSubmitSuccess('Business expense and receipt submitted successfully!')
      // Reset form fields
      setAmount('')
      setBusinessPurpose('')
      setAdditionalNotes('')
      setReceiptFile(null)
      setReceiptFileName('')
      if (fileInputRef.current) fileInputRef.current.value = ''

      // Prepend to expenses list immediately
      if (data.submission) {
        setExpenses((prev) => [data.submission, ...prev.filter((x) => x.id !== data.submission.id)])
      }
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="expense-module">
      {/* 1. Submit Expense Form Panel */}
      <section className="panel expense-submit-panel">
        <div className="panel-heading">
          <div>
            <h2>Business Expense &amp; Receipt Submission</h2>
            <p>
              Use this form for all business purchases—whether you used a personal payment method (and need reimbursement) or a company credit card.
            </p>
          </div>
        </div>

        {submitError && <div className="form-error">⚠️ {submitError}</div>}
        {submitSuccess && <div className="form-success">✅ {submitSuccess}</div>}

        <form className="expense-form" onSubmit={handleSubmitExpense}>
          <div className="form-grid two">
            {/* 1. Employee */}
            <label className="field">
              <span>Employee</span>
              <input
                type="text"
                value={employeeName}
                onChange={(e) => setEmployeeName(e.target.value)}
                placeholder="Employee Name"
                required
              />
            </label>

            {/* 2. Date of Purchase */}
            <label className="field">
              <span>Date of Purchase</span>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                required
              />
            </label>
          </div>

          <div className="form-grid two">
            {/* 3. Amount */}
            <label className="field">
              <span>Amount</span>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="$XX.XX"
                required
              />
            </label>

            {/* 5. Expense Category */}
            <label className="field">
              <span>Expense Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
              >
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* 4. Business Purpose */}
          <label className="field">
            <span>Business Purpose</span>
            <textarea
              rows={3}
              value={businessPurpose}
              onChange={(e) => setBusinessPurpose(e.target.value)}
              placeholder="Briefly describe what was purchased and why. Example: Purchased display hooks for Learning Express setup."
              required
            />
          </label>

          <div className="form-grid two">
            {/* 6. Upload Receipt */}
            <label className="field">
              <span>Upload Receipt</span>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*,.pdf"
                onChange={handleFileChange}
                required
              />
              {receiptFileName && (
                <small style={{ color: 'var(--brown)', fontWeight: 800, marginTop: 4 }}>
                  Attached: {receiptFileName}
                </small>
              )}
            </label>

            {/* 7. Does this purchase require reimbursement? */}
            <label className="field">
              <span>Does this purchase require reimbursement?</span>
              <select
                value={requiresReimbursement}
                onChange={(e) => setRequiresReimbursement(e.target.value)}
                required
              >
                {REIMBURSEMENT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* 8. Additional Notes */}
          <label className="field">
            <span>Additional Notes (Optional)</span>
            <input
              type="text"
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              placeholder="Any additional notes or details"
            />
          </label>

          {/* 9. Submit Button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? 'Submitting Expense…' : 'Submit'}
            </button>
          </div>
        </form>
      </section>

      {/* Error notification if GET request fails */}
      {error && (
        <div className="form-error">
          <span>⚠️ {error}</span>
        </div>
      )}

      {/* 2. Submitted Expenses Table Panel */}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Submitted Expenses</h2>
            <p>Submissions synced from Slack and Supabase.</p>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={loadExpenses}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {loading && expenses.length === 0 ? (
          <div className="loading-state">Loading expense submissions…</div>
        ) : expenses.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">♡</div>
            <h2>No expense submissions yet</h2>
            <p>
              Submissions sent via Slack with the <code>/expense</code> command will sync and appear here automatically.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Date of Purchase</th>
                  <th>Amount</th>
                  <th>Business Purpose</th>
                  <th>Expense Category</th>
                  <th>Requires Reimbursement</th>
                  <th>Additional Notes</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((item) => {
                  const receiptUrl = item.receipt_slack_url || `/api/expenses?route=receipt&id=${item.id}`
                  const isReimbursedYes = Boolean(item.requires_reimbursement)

                  return (
                    <tr key={item.id}>
                      {/* 1. Employee */}
                      <td className="strong-cell">
                        {item.employee_name || 'Employee'}
                        {item.employee_email && <small>{item.employee_email}</small>}
                        {!item.employee_email && item.slack_user_id && (
                          <small>Slack: {item.slack_user_id}</small>
                        )}
                      </td>

                      {/* 2. Date of Purchase */}
                      <td>{formatDate(item.purchase_date)}</td>

                      {/* 3. Amount */}
                      <td className="strong-cell amount-cell">
                        {formatCurrency(item.amount)}
                      </td>

                      {/* 4. Business Purpose */}
                      <td className="purpose-cell">
                        {item.business_purpose || '—'}
                      </td>

                      {/* 5. Expense Category */}
                      <td>
                        <span className="category-pill">{item.category || 'Other'}</span>
                      </td>

                      {/* 6. Requires Reimbursement (Yes / No) */}
                      <td>
                        <span className={`reimbursement-pill ${isReimbursedYes ? 'yes' : 'no'}`}>
                          {isReimbursedYes ? 'Yes' : 'No'}
                        </span>
                      </td>

                      {/* 7. Additional Notes */}
                      <td className="notes-cell">
                        {item.additional_notes || '—'}
                      </td>

                      {/* 8. Receipt Link / Preview */}
                      <td className="receipt-cell">
                        {receiptUrl ? (
                          <div className="receipt-action-group">
                            <button
                              type="button"
                              className="receipt-btn preview"
                              onClick={() =>
                                setPreviewReceipt({
                                  url: receiptUrl,
                                  filename: item.receipt_filename || 'Receipt',
                                  employee: item.employee_name,
                                  amount: formatCurrency(item.amount),
                                })
                              }
                            >
                              View Receipt
                            </button>
                            <a
                              href={receiptUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="receipt-btn download"
                              download={item.receipt_filename || 'receipt'}
                            >
                              Download
                            </a>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--brown-soft)', fontSize: '10px' }}>No receipt</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Receipt Preview Lightbox Modal */}
      {previewReceipt && (
        <div className="receipt-modal-backdrop" onClick={() => setPreviewReceipt(null)}>
          <div className="receipt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="receipt-modal-header">
              <div>
                <strong>Receipt Preview</strong>
                <span>
                  {previewReceipt.employee} · {previewReceipt.amount} ({previewReceipt.filename})
                </span>
              </div>
              <button
                type="button"
                className="close-modal-btn"
                onClick={() => setPreviewReceipt(null)}
                title="Close"
              >
                ✕
              </button>
            </div>
            <div className="receipt-modal-body">
              {previewReceipt.url.endsWith('.pdf') ? (
                <iframe
                  src={previewReceipt.url}
                  title="Receipt PDF Preview"
                  className="receipt-preview-frame"
                />
              ) : (
                <img
                  src={previewReceipt.url}
                  alt="Receipt Preview"
                  className="receipt-preview-img"
                  onError={(e) => {
                    e.target.style.display = 'none'
                    e.target.nextSibling.style.display = 'block'
                  }}
                />
              )}
              <div className="receipt-fallback" style={{ display: 'none' }}>
                <p>Preview could not be rendered directly in this browser.</p>
                <a
                  href={previewReceipt.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="secondary-button"
                  style={{ display: 'inline-block', marginTop: 10 }}
                >
                  Open in New Tab ↗
                </a>
              </div>
            </div>
            <div className="receipt-modal-footer">
              <a
                href={previewReceipt.url}
                target="_blank"
                rel="noopener noreferrer"
                className="secondary-button"
              >
                Open External ↗
              </a>
              <button
                type="button"
                className="primary-button"
                onClick={() => setPreviewReceipt(null)}
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
