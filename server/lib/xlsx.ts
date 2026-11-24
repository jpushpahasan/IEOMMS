import ExcelJS from 'exceljs';
import type { Response } from 'express';

export type Col = [key: string, header: string, width: number];

export function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A4A' } };
  row.alignment = { vertical: 'middle' };
  row.height = 20;
}

export async function sendXlsx(res: Response, title: string, cols: Col[], rows: Record<string, unknown>[], company: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IEOMMS';
  wb.created = new Date();
  const ws = wb.addWorksheet(title.slice(0, 31));
  ws.addRow([company]).font = { bold: true, size: 13 };
  ws.addRow([`${title} — generated ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dubai' })} (GST)`]).font = { italic: true, color: { argb: 'FF555555' } };
  ws.addRow([]);
  styleHeader(ws.addRow(cols.map((c) => c[1])));
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c[2]; });
  for (const r of rows) ws.addRow(cols.map(([k]) => {
    const v = r[k];
    if (v == null) return '';
    if (/(salary|allowance|cost|amount)/.test(k) && /^\d+(\.\d+)?$/.test(String(v))) return Number(v);
    return v as ExcelJS.CellValue;
  }));
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
  const name = `${title.replace(/[^A-Za-z0-9]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}
