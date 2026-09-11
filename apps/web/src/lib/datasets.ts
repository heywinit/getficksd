import Papa from "papaparse";
import { readSheet } from "read-excel-file/browser";

export type DatasetColumnType = "string" | "number" | "boolean" | "date";

export type ColumnMapping = {
  source: string;
  target: string;
  type: DatasetColumnType;
  required: boolean;
};

export type ParsedDataset = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  warnings: string[];
};

export type PreparedDataset = {
  rows: Array<Record<string, unknown>>;
  errors: Array<{ row: number; column: string; message: string }>;
};

export async function parseDatasetFile(file: File): Promise<ParsedDataset> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv") {
    return parseCsv(await file.text());
  }
  if (extension === "xlsx") {
    return parseSpreadsheet(file);
  }
  if (extension === "json") {
    return parseJson(await file.text());
  }

  throw new Error("Choose a CSV, XLSX, or JSON file.");
}

function parseCsv(content: string): ParsedDataset {
  const result = Papa.parse<Record<string, unknown>>(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    transformHeader: normalizeHeader,
  });
  const columns = result.meta.fields ?? [];

  if (!columns.length) {
    throw new Error("The CSV file does not have a header row.");
  }

  return {
    columns,
    rows: result.data.map(normalizeRecord),
    warnings: result.errors.map((error) => `Row ${error.row ?? "?"}: ${error.message}`),
  };
}

async function parseSpreadsheet(file: File): Promise<ParsedDataset> {
  const sheet = await readSheet(file);
  const [headerRow, ...dataRows] = sheet;

  if (!headerRow?.length) {
    throw new Error("The spreadsheet does not have a header row.");
  }

  const columns = headerRow.map((cell, index) =>
    normalizeHeader(String(cell ?? `column_${index + 1}`)),
  );
  const rows = dataRows
    .filter((row) => row.some((cell) => cell !== null && cell !== ""))
    .map((row) =>
      Object.fromEntries(columns.map((column, index) => [column, normalizeValue(row[index])])),
    );

  return { columns, rows, warnings: [] };
}

function parseJson(content: string): ParsedDataset {
  const value = JSON.parse(content) as unknown;
  const source = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.data)
      ? value.data
      : null;

  if (!source) {
    throw new Error('JSON must be an array of objects or an object with a "data" array.');
  }

  const records = source.filter(isRecord).map(normalizeRecord);
  if (records.length !== source.length) {
    throw new Error("Every JSON row must be an object.");
  }

  const columns = [...new Set(records.flatMap((record) => Object.keys(record)))];
  if (!columns.length) {
    throw new Error("The JSON file has no columns.");
  }

  return { columns, rows: records, warnings: [] };
}

export function createDefaultMappings(parsed: ParsedDataset): ColumnMapping[] {
  return parsed.columns.map((column) => ({
    source: column,
    target: column,
    type: inferColumnType(parsed.rows.map((row) => row[column])),
    required: false,
  }));
}

export function prepareDataset(
  rows: Array<Record<string, unknown>>,
  mappings: ColumnMapping[],
): PreparedDataset {
  const errors: PreparedDataset["errors"] = [];
  const preparedRows = rows.map((row, rowIndex) => {
    const prepared: Record<string, unknown> = {};

    for (const mapping of mappings) {
      const value = row[mapping.source];
      const isEmpty = value === null || value === undefined || value === "";
      if (isEmpty) {
        prepared[mapping.target] = null;
        if (mapping.required) {
          errors.push({
            row: rowIndex + 1,
            column: mapping.target,
            message: `${mapping.target} is required.`,
          });
        }
        continue;
      }

      const normalized = coerceValue(value, mapping.type);
      prepared[mapping.target] = normalized.value;
      if (normalized.error) {
        errors.push({ row: rowIndex + 1, column: mapping.target, message: normalized.error });
      }
    }

    return prepared;
  });

  return { rows: preparedRows, errors };
}

function inferColumnType(values: unknown[]): DatasetColumnType {
  const present = values.filter((value) => value !== null && value !== undefined && value !== "");
  if (!present.length) {
    return "string";
  }
  if (present.every((value) => typeof value === "number")) {
    return "number";
  }
  if (present.every((value) => typeof value === "boolean")) {
    return "boolean";
  }
  if (present.every((value) => value instanceof Date)) {
    return "date";
  }
  return "string";
}

function coerceValue(value: unknown, type: DatasetColumnType) {
  if (type === "string") {
    return { value: typeof value === "object" ? JSON.stringify(value) : String(value) };
  }
  if (type === "number") {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number)
      ? { value: number }
      : { value, error: `Expected a number, received ${String(value)}.` };
  }
  if (type === "boolean") {
    const normalized = String(value).toLowerCase().trim();
    if (["true", "1", "yes"].includes(normalized)) return { value: true };
    if (["false", "0", "no"].includes(normalized)) return { value: false };
    return { value, error: `Expected a boolean, received ${String(value)}.` };
  }

  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? { value, error: `Expected a date, received ${String(value)}.` }
    : { value: date.toISOString() };
}

function normalizeHeader(header: string) {
  return header.trim() || "unnamed_column";
}

function normalizeRecord(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [normalizeHeader(key), normalizeValue(value)]),
  );
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
