import { useEffect, useState } from 'react'
import './expenses.css'

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

export default function ExpenseApp({ user, token: propToken }) {
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [previewReceipt, setPreviewReceipt] = useState(null)

  const token = propToken || user?.expense_token || ''

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
      setExpenses(data.expenses || [])
    } catch (err) {
      console.error('[ExpenseApp] Failed to load expenses:', err)
      setError(err.message || 'Could not load expense records.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadExpenses()
  }, [token])

  return (
    <div className="expense-module">
      {/* Content Header matching Hub standard */}
      <div className="content-header">
        <div>
          <span className="eyebrow">Finance Operations</span>
          <h1>Business Expense &amp; Receipt Submission</h1>
          <p>
            Submissions synced from Slack and Supabase.
          </p>
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

      {/* Error notification if request fails */}
      {error && (
        <div className="form-error">
          <span>⚠️ {error}</span>
        </div>
      )}

      {/* Submissions Table */}
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
                            title="Preview receipt"
                          >
                            👁 View
                          </button>
                          <a
                            href={receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="receipt-btn download"
                            download={item.receipt_filename || 'receipt'}
                            title="Open or download file"
                          >
                            ⬇
                          </a>
                        </div>
                      ) : (
                        <span className="muted-text">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Clean Receipt Preview Modal */}
      {previewReceipt && (
        <div className="receipt-modal-backdrop" onClick={() => setPreviewReceipt(null)}>
          <div className="receipt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="receipt-modal-header">
              <div>
                <strong>{previewReceipt.filename}</strong>
                <span>
                  {previewReceipt.employee} · {previewReceipt.amount}
                </span>
              </div>
              <button
                type="button"
                className="close-modal-btn"
                onClick={() => setPreviewReceipt(null)}
              >
                ✕
              </button>
            </div>
            <div className="receipt-modal-body">
              {/\.(png|jpe?g|gif|webp|svg)($|\?)/i.test(previewReceipt.url) ||
              !/\.pdf($|\?)/i.test(previewReceipt.url) ? (
                <img
                  src={previewReceipt.url}
                  alt={previewReceipt.filename}
                  className="receipt-preview-img"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                    const fallback = e.currentTarget.nextElementSibling
                    if (fallback) fallback.style.display = 'block'
                  }}
                />
              ) : null}
              <div className="receipt-fallback" style={{ display: 'none' }}>
                <p>Unable to render inline image preview.</p>
              </div>
              {/\.pdf($|\?)/i.test(previewReceipt.url) && (
                <iframe
                  src={previewReceipt.url}
                  title="Receipt PDF Preview"
                  className="receipt-preview-frame"
                />
              )}
            </div>
            <div className="receipt-modal-footer">
              <a
                href={previewReceipt.url}
                target="_blank"
                rel="noopener noreferrer"
                className="primary-button"
              >
                Open in New Tab / Download
              </a>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPreviewReceipt(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
