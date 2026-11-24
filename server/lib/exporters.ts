// Excel and PDF renderers for management reports.
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import { label } from './enums.ts';
import { styleHeader } from './xlsx.ts';

/** [key, header, type, width (Excel characters)]. Types: text, date, datetime, money, int, pct, enum:<list>. */
export type ReportCol = [key: string, header: string, type: string, width: number];
export interface ReportMeta { title: string; company: string; filters: string; user: string; count: number; orientation?: 'landscape' | 'portrait' }

const stamp = () => new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fileName = (title: string, ext: string) => `${title.replace(/^\d+\.\s*/, '').replace(/[^A-Za-z0-9]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.${ext}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Display text for a cell (used by PDF and for Excel text columns). */
export function display(type: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (type.startsWith('enum:')) return label(type.slice(5), v);
  const s = v instanceof Date ? v.toISOString() : String(v);
  if (type === 'date') { const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : s; }
  if (type === 'datetime') { const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})/); return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]} ${m[4]}` : s; }
  if (type === 'money') return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === 'pct') return `${v}%`;
  return s;
}

export async function sendReportXlsx(res: Response, meta: ReportMeta, cols: ReportCol[], rows: Record<string, unknown>[], totals: Record<string, number> | null) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IEOMMS';
  wb.created = new Date();
  const ws = wb.addWorksheet(meta.title.replace(/[\\/?*[\]:]/g, '').slice(0, 31), { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  ws.addRow([meta.company]).font = { bold: true, size: 14, color: { argb: 'FF0F2A4A' } };
  ws.addRow([meta.title]).font = { bold: true, size: 12 };
  ws.addRow([`Filters: ${meta.filters}`]).font = { italic: true, color: { argb: 'FF555555' } };
  ws.addRow([`Generated ${stamp()} (GST) by ${meta.user} · ${meta.count} record(s)`]).font = { italic: true, color: { argb: 'FF555555' } };
  ws.addRow([]);
  const hr = ws.addRow(cols.map((c) => c[1]));
  styleHeader(hr);
  hr.alignment = { vertical: 'middle', wrapText: true };
  hr.height = 30;
  cols.forEach(([, , type, w], i) => {
    const col = ws.getColumn(i + 1);
    col.width = w;
    if (type === 'money') col.numFmt = '#,##0.00';
    if (type === 'date') col.numFmt = 'dd-mmm-yyyy';
    if (type === 'datetime') col.numFmt = 'dd-mmm-yyyy hh:mm';
    if (type === 'int') col.numFmt = '0';
  });
  for (const r of rows) {
    ws.addRow(cols.map(([k, , type]) => {
      const v = r[k];
      if (v === null || v === undefined || v === '') return null;
      if (type === 'money' || type === 'int') return Number(v);
      if (type === 'pct') return Number(v) / 100;
      if (type === 'date') { const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : String(v); }
      if (type === 'datetime') { const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : String(v); }
      return display(type, v);
    }));
  }
  cols.forEach(([, , type], i) => { if (type === 'pct') ws.getColumn(i + 1).numFmt = '0%'; });
  if (totals && Object.keys(totals).length) {
    const tr = ws.addRow(cols.map(([k], i) => (i === 0 ? 'Total' : k in totals ? totals[k] : null)));
    tr.font = { bold: true };
    tr.border = { top: { style: 'thin' } };
  }
  ws.views = [{ state: 'frozen', ySplit: 6 }];
  ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: cols.length } };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName(meta.title, 'xlsx')}"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}

export function sendReportPdf(res: Response, meta: ReportMeta, cols: ReportCol[], rows: Record<string, unknown>[], totals: Record<string, number> | null) {
  const landscape = meta.orientation !== 'portrait';
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margins: { top: 36, bottom: 40, left: 30, right: 30 }, bufferPages: true,
    info: { Title: meta.title, Author: meta.company, Creator: 'IEOMMS' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName(meta.title, 'pdf')}"`);
  doc.pipe(res);
  const pageW = doc.page.width - 60;
  const totalW = cols.reduce((s, c) => s + c[3], 0);
  const fontSize = cols.length > 12 ? 6.5 : cols.length > 9 ? 7 : 8;
  // Proportional widths, but never narrower than the longest single word of the heading (no mid-word breaks).
  doc.font('Helvetica-Bold').fontSize(fontSize);
  const minW = cols.map((c) => Math.max(...c[1].split(/\s+/).map((w) => doc.widthOfString(w))) + 8);
  const widths = cols.map((c, i) => Math.max((c[3] / totalW) * pageW, minW[i]));
  for (let pass = 0; pass < 5; pass++) {
    const excess = widths.reduce((s, w) => s + w, 0) - pageW;
    if (excess <= 0.5) break;
    const slack = widths.map((w, i) => Math.max(0, w - minW[i]));
    const totalSlack = slack.reduce((s, x) => s + x, 0);
    if (!totalSlack) break;
    widths.forEach((_, i) => { widths[i] -= (slack[i] / totalSlack) * excess; });
  }
  const right = (t: string) => ['money', 'int', 'pct'].includes(t);
  const NAVY = '#0f2a4a';

  const header = () => {
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text(meta.company, 30, 30);
    doc.fillColor('#111').fontSize(11).text(meta.title);
    doc.font('Helvetica').fontSize(7.5).fillColor('#555').text(`Filters: ${meta.filters}`, { width: pageW });
    doc.text(`Generated ${stamp()} (GST) by ${meta.user} · ${meta.count} record(s)`);
    doc.moveDown(0.4);
    tableHeader();
  };
  const tableHeader = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(fontSize);
    const h = Math.max(...cols.map((c, i) => doc.heightOfString(c[1], { width: widths[i] - 6 }))) + 8;
    doc.rect(30, y, pageW, h).fill(NAVY);
    let x = 30;
    cols.forEach((c, i) => { doc.fillColor('#fff').text(c[1], x + 3, y + 4, { width: widths[i] - 6, align: right(c[2]) ? 'right' : 'left' }); x += widths[i]; });
    doc.y = y + h;
  };
  const row = (cells: string[], opts: { bold?: boolean; shade?: boolean } = {}) => {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
    const h = Math.max(...cells.map((t, i) => doc.heightOfString(t || ' ', { width: widths[i] - 6 }))) + 6;
    if (doc.y + h > doc.page.height - 44) { doc.addPage(); doc.y = 36; tableHeader(); doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize); }
    const y = doc.y;
    if (opts.shade) doc.rect(30, y, pageW, h).fill('#f1f5f9');
    let x = 30;
    cells.forEach((t, i) => {
      const flag = t === 'OPEN' ? '#b91c1c' : t === 'OK' ? '#047857' : '#1e293b';
      doc.fillColor(flag).text(t, x + 3, y + 3, { width: widths[i] - 6, align: right(cols[i][2]) ? 'right' : 'left' });
      x += widths[i];
    });
    doc.moveTo(30, y + h).lineTo(30 + pageW, y + h).lineWidth(0.3).strokeColor('#e2e8f0').stroke();
    doc.y = y + h;
  };

  header();
  if (!rows.length) doc.font('Helvetica-Oblique').fontSize(9).fillColor('#555').text('No records match the selected filters.', 30, doc.y + 10);
  rows.forEach((r, i) => row(cols.map(([k, , t]) => display(t, r[k])), { shade: i % 2 === 1 }));
  if (totals && Object.keys(totals).length && rows.length) row(cols.map(([k, , t], i) => (i === 0 ? 'Total' : k in totals ? display(t, totals[k]) : '')), { bold: true, shade: true });

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // writing the footer inside the margin must not create a new page
    doc.font('Helvetica').fontSize(7).fillColor('#888')
      .text(`${meta.company} · ${meta.title} · Page ${i + 1} of ${range.count}`, 30, doc.page.height - 28, { width: pageW, align: 'center', lineBreak: false });
  }
  doc.end();
}
