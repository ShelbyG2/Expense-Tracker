// XLSX serialization for the Phase 4/7C report exports, built with exceljs.
// Kept out of the route handler so the sheet layout is easy to change and the
// builders can be reused by scripts. Headers name the currency (Phase 7D).

import ExcelJS from 'exceljs'
import { budgetHeader } from '@/services/report-csv'
import type {
  BudgetVsActualRow,
  SummaryReport,
} from '@/services/report-service'

function headerRow(sheet: ExcelJS.Worksheet, values: string[]) {
  const row = sheet.addRow(values)
  row.font = { bold: true }
  sheet.columns.forEach((column, index) => {
    column.width = index === 0 ? 24 : 16
  })
}

export async function summaryToXlsx(
  report: SummaryReport,
  currency: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Summary')
  const amount = ` (${currency})`

  sheet.addRow(['Expense summary', report.month]).font = { bold: true }
  sheet.addRow([`Total approved${amount}`, report.totalApproved])
  sheet.addRow([`Awaiting approval${amount}`, report.awaitingApproval])
  sheet.addRow([])

  headerRow(sheet, ['Category', `Approved${amount}`])
  for (const row of report.byCategory) sheet.addRow([row.category, row.total])
  sheet.addRow([])

  headerRow(sheet, ['Department', `Approved${amount}`])
  for (const row of report.byDepartment) sheet.addRow([row.name, row.total])

  for (const column of [2]) {
    sheet.getColumn(column).numFmt = '#,##0.00'
  }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function budgetToXlsx(
  rows: BudgetVsActualRow[],
  month: string,
  currency: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(`Budget vs actual ${month}`)

  headerRow(sheet, budgetHeader(currency))
  for (const row of rows) {
    sheet.addRow([
      row.departmentName,
      row.category,
      row.budget ?? '',
      row.carriedOver,
      row.available ?? '',
      row.spent,
      row.remaining ?? '',
      row.percentUsed === null ? '' : Math.round(row.percentUsed * 1000) / 10,
      row.status,
      row.awaitingApproval,
    ])
  }

  for (const column of [3, 4, 5, 6, 7, 10]) {
    sheet.getColumn(column).numFmt = '#,##0.00'
  }
  // Percentage column (8) is written as 75 for 75%.
  sheet.getColumn(8).numFmt = '0.0'

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
