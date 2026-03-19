import { PDFDocument, StandardFonts } from "pdf-lib";
import ExcelJS from "exceljs";

type ExportValue = string | number | boolean | Date | null | undefined;
type ExportRow = Record<string, ExportValue>;

export type ExportColumn<T extends ExportRow = ExportRow> = {
  key: keyof T & string;
  label: string;
};

function stringifyExportValue(value: ExportValue) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(/\r?\n/g, " ").trim();
}

function escapeCsvCell(value: ExportValue) {
  const text = stringifyExportValue(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function truncateText(value: string, width: number) {
  if (value.length <= width) {
    return value.padEnd(width, " ");
  }

  if (width <= 1) {
    return value.slice(0, width);
  }

  return `${value.slice(0, Math.max(0, width - 1))}\u2026`;
}

function computeColumnWidths<T extends ExportRow>(
  columns: ExportColumn<T>[],
  rows: T[],
  maxTotalChars: number
) {
  const baseWidths = columns.map((column) => {
    const maxValueLength = rows.reduce((max, row) => {
      return Math.max(max, stringifyExportValue(row[column.key]).length);
    }, column.label.length);

    return Math.min(26, Math.max(8, maxValueLength + 2));
  });

  const totalSeparatorWidth = Math.max(0, (columns.length - 1) * 3);
  let totalWidth =
    baseWidths.reduce((sum, width) => sum + width, 0) + totalSeparatorWidth;

  if (totalWidth <= maxTotalChars) {
    return baseWidths;
  }

  const widths = [...baseWidths];
  while (totalWidth > maxTotalChars) {
    const widestIndex = widths.findIndex(
      (width) => width === Math.max(...widths)
    );

    if (widestIndex < 0 || widths[widestIndex] <= 8) {
      break;
    }

    widths[widestIndex] -= 1;
    totalWidth -= 1;
  }

  return widths;
}

function formatPdfRow<T extends ExportRow>(
  columns: ExportColumn<T>[],
  row: T,
  widths: number[]
) {
  return columns
    .map((column, index) =>
      truncateText(stringifyExportValue(row[column.key]), widths[index])
    )
    .join(" | ");
}

export function buildCsv<T extends ExportRow>(
  columns: ExportColumn<T>[],
  rows: T[]
) {
  const header = columns.map((column) => escapeCsvCell(column.label)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvCell(row[column.key])).join(",")
  );

  return [header, ...body].join("\n");
}

export async function buildXlsxBuffer<T extends ExportRow>(input: {
  sheetName: string;
  columns: ExportColumn<T>[];
  rows: T[];
}) {
  const { sheetName, columns, rows } = input;
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31) || "Report");

  worksheet.addRow(columns.map((column) => column.label));
  worksheet.addRows(
    rows.map((row) => columns.map((column) => stringifyExportValue(row[column.key])))
  );

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  columns.forEach((column, index) => {
    worksheet.getColumn(index + 1).width = Math.min(
      36,
      Math.max(
        column.label.length + 2,
        ...rows.map((row) => stringifyExportValue(row[column.key]).length + 2)
      )
    );
  });

  if (rows.length > 0 && columns.length > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rows.length + 1, column: columns.length },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

export async function buildPdfBuffer<T extends ExportRow>(input: {
  title: string;
  subtitleLines?: string[];
  columns: ExportColumn<T>[];
  rows: T[];
}) {
  const { title, subtitleLines = [], columns, rows } = input;
  const pdf = await PDFDocument.create();
  const titleFont = await pdf.embedFont(StandardFonts.CourierBold);
  const bodyFont = await pdf.embedFont(StandardFonts.Courier);
  const landscape = columns.length >= 8;
  const pageSize: [number, number] = landscape ? [841.89, 595.28] : [595.28, 841.89];
  const margin = landscape ? 30 : 40;
  const fontSize = 9;
  const lineHeight = 12;
  const maxChars = landscape ? 132 : 92;
  const widths = computeColumnWidths(columns, rows, maxChars);
  const headerRow = columns
    .map((column, index) => truncateText(column.label, widths[index]))
    .join(" | ");
  const separator = "-".repeat(Math.min(maxChars, headerRow.length));
  const rowLines =
    rows.length === 0
      ? ["No records found."]
      : rows.map((row) => formatPdfRow(columns, row, widths));

  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - margin;

  const drawLine = (
    line: string,
    options?: { bold?: boolean; size?: number }
  ) => {
    if (y < margin) {
      page = pdf.addPage(pageSize);
      y = pageSize[1] - margin;
      page.drawText(`${title} (continued)`, {
        x: margin,
        y,
        size: 12,
        font: titleFont,
      });
      y -= 18;
      page.drawText(headerRow, {
        x: margin,
        y,
        size: fontSize,
        font: titleFont,
      });
      y -= lineHeight;
      page.drawText(separator, {
        x: margin,
        y,
        size: fontSize,
        font: bodyFont,
      });
      y -= lineHeight;
    }

    page.drawText(line, {
      x: margin,
      y,
      size: options?.size ?? fontSize,
      font: options?.bold ? titleFont : bodyFont,
    });
    y -= lineHeight;
  };

  drawLine(title, { bold: true, size: 12 });
  y -= 6;

  for (const subtitle of subtitleLines) {
    drawLine(subtitle);
  }

  if (subtitleLines.length > 0) {
    y -= 6;
  }

  drawLine(headerRow, { bold: true });
  drawLine(separator);

  for (const line of rowLines) {
    drawLine(line);
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
