// Small fetch helper for the Attendance API (served from the Birthday API function).
export async function attendanceApi(op, { method = 'GET', token, body, query = '' } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body) headers['Content-Type'] = 'application/json'
  const response = await fetch(`/api/birthday?route=attendance&op=${op}${query}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return data
}
