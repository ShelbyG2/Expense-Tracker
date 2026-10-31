// Minimal CSV serialization for report exports (RFC 4180-style escaping).
// Pure functions so the format can be unit-tested without a database.

// A value is quoted when it contains a comma, quote or newline; embedded
// quotes are doubled.
export function csvCell(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : value
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

// Rows are joined with CRLF, as spreadsheet tools expect.
export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
