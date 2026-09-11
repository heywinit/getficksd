import { Checkbox } from "@getficksd/ui/components/checkbox";
import { Field, FieldError, FieldLabel } from "@getficksd/ui/components/field";
import { Input } from "@getficksd/ui/components/input";
import { AlertCircleIcon, DatabaseIcon, FileSpreadsheetIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { FileDropzone } from "@/components/file-dropzone";
import { FormWizard } from "@/components/forms/form-wizard";
import { clearDraft, loadDraft, useAutosaveDraft } from "@/hooks/use-autosave-draft";
import {
  createDefaultMappings,
  parseDatasetFile,
  prepareDataset,
  type ColumnMapping,
  type ParsedDataset,
} from "@/lib/datasets";

const DRAFT_KEY = "getficksd:dataset-import";

const mappingSchema = z
  .array(
    z.object({
      source: z.string().min(1),
      target: z.string().trim().min(1, "Every column needs a name."),
      type: z.enum(["string", "number", "boolean", "date"]),
      required: z.boolean(),
    }),
  )
  .min(1)
  .refine((columns) => new Set(columns.map((column) => column.target)).size === columns.length, {
    message: "Mapped column names must be unique.",
  });

type ImportDraft = {
  name: string;
  mappings: ColumnMapping[];
};

type LoadDatasetInput = {
  file: File;
  name: string;
  columns: ColumnMapping[];
  rows: Array<Record<string, unknown>>;
};

type DatasetWorkbenchProps = {
  onLoad: (input: LoadDatasetInput) => Promise<void>;
};

export function DatasetWorkbench({ onLoad }: DatasetWorkbenchProps) {
  const [file, setFile] = useState<File>();
  const [parsed, setParsed] = useState<ParsedDataset>();
  const [name, setName] = useState("");
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [step, setStep] = useState(0);
  const [isParsing, setIsParsing] = useState(false);
  const [formError, setFormError] = useState<string>();

  useEffect(() => {
    const draft = loadDraft<ImportDraft | null>(DRAFT_KEY, null);
    if (draft) {
      setName(draft.name);
      setMappings(draft.mappings);
    }
  }, []);

  const draft = useMemo(() => ({ name, mappings }), [name, mappings]);
  const draftStatus = useAutosaveDraft(DRAFT_KEY, draft);
  const prepared = useMemo(
    () => prepareDataset(parsed?.rows ?? [], mappings),
    [mappings, parsed?.rows],
  );

  async function selectFile(files: File[]) {
    const selected = files[0];
    if (!selected) return;

    setIsParsing(true);
    setFormError(undefined);
    try {
      const result = await parseDatasetFile(selected);
      const restoredMappings = restoreMappings(result, mappings);
      setFile(selected);
      setParsed(result);
      setName((current) => current || selected.name.replace(/\.[^.]+$/, ""));
      setMappings(restoredMappings);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read this file.";
      setFormError(message);
      toast.error(message);
    } finally {
      setIsParsing(false);
    }
  }

  function updateMapping(index: number, update: Partial<ColumnMapping>) {
    setMappings((current) =>
      current.map((mapping, mappingIndex) =>
        mappingIndex === index ? { ...mapping, ...update } : mapping,
      ),
    );
  }

  async function validateStep(currentStep: number) {
    setFormError(undefined);

    if (currentStep === 0) {
      if (!file || !parsed) {
        setFormError("Choose a file before you continue.");
        return false;
      }
      if (!name.trim()) {
        setFormError("Enter a dataset name.");
        return false;
      }
    }

    if (currentStep === 1) {
      const result = mappingSchema.safeParse(mappings);
      if (!result.success) {
        setFormError(result.error.issues[0]?.message ?? "Check the column mapping.");
        return false;
      }
    }

    return true;
  }

  async function load() {
    if (!file || !parsed) return;

    await onLoad({ file, name: name.trim(), columns: mappings, rows: parsed.rows });
    clearDraft(DRAFT_KEY);
    setFile(undefined);
    setParsed(undefined);
    setName("");
    setMappings([]);
    setStep(0);
  }

  const steps = [
    {
      id: "source",
      title: "Source",
      description: "Choose a file",
      content: (
        <div className="space-y-4">
          <FileDropzone
            accept=".csv,.xlsx,.json,text/csv,application/json"
            disabled={isParsing}
            multiple={false}
            onSelect={selectFile}
          />
          {file && parsed ? (
            <div className="flex items-center gap-3 border p-3">
              <FileSpreadsheetIcon className="size-4" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {parsed.rows.length} rows · {parsed.columns.length} columns
                </p>
              </div>
            </div>
          ) : null}
          <Field data-invalid={!name.trim() && Boolean(formError)}>
            <FieldLabel htmlFor="dataset-name">Dataset name</FieldLabel>
            <Input
              id="dataset-name"
              value={name}
              placeholder="Customer records"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {parsed?.warnings.length ? (
            <p className="text-xs text-amber-700">{parsed.warnings[0]}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: "mapping",
      title: "Map",
      description: "Name and type columns",
      content: <ColumnMapper mappings={mappings} onChange={updateMapping} />,
    },
    {
      id: "validation",
      title: "Validate",
      description: "Review data issues",
      content: <ValidationSummary rowCount={prepared.rows.length} errors={prepared.errors} />,
    },
    {
      id: "preview",
      title: "Preview",
      description: "Check and load",
      content: <PreviewTable rows={prepared.rows} columns={mappings.map((item) => item.target)} />,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end text-xs text-muted-foreground" aria-live="polite">
        {draftStatus === "saving"
          ? "Saving draft..."
          : draftStatus === "saved"
            ? "Draft saved"
            : null}
      </div>
      <FormWizard
        steps={steps}
        currentStep={step}
        onStepChange={setStep}
        onNext={validateStep}
        onComplete={load}
        completeLabel="Load dataset"
      />
      {formError ? <FieldError>{formError}</FieldError> : null}
    </div>
  );
}

function ColumnMapper({
  mappings,
  onChange,
}: {
  mappings: ColumnMapping[];
  onChange: (index: number, update: Partial<ColumnMapping>) => void;
}) {
  return (
    <div className="overflow-x-auto border">
      <table className="w-full min-w-2xl text-left text-xs">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className="p-3 font-medium">Source</th>
            <th className="p-3 font-medium">Mapped name</th>
            <th className="p-3 font-medium">Type</th>
            <th className="p-3 font-medium">Required</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {mappings.map((mapping, index) => (
            <tr key={mapping.source}>
              <td className="p-3 font-mono">{mapping.source}</td>
              <td className="p-3">
                <Input
                  value={mapping.target}
                  aria-label={`Mapped name for ${mapping.source}`}
                  onChange={(event) => onChange(index, { target: event.target.value })}
                />
              </td>
              <td className="p-3">
                <select
                  className="h-8 w-full border border-input bg-background px-2 text-xs"
                  value={mapping.type}
                  aria-label={`Type for ${mapping.source}`}
                  onChange={(event) =>
                    onChange(index, { type: event.target.value as ColumnMapping["type"] })
                  }
                >
                  <option value="string">Text</option>
                  <option value="number">Number</option>
                  <option value="boolean">Boolean</option>
                  <option value="date">Date</option>
                </select>
              </td>
              <td className="p-3">
                <Checkbox
                  checked={mapping.required}
                  aria-label={`Require ${mapping.source}`}
                  onCheckedChange={(checked) => onChange(index, { required: checked })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ValidationSummary({
  rowCount,
  errors,
}: {
  rowCount: number;
  errors: Array<{ row: number; column: string; message: string }>;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="border p-4">
          <DatabaseIcon className="mb-3 size-4" />
          <p className="text-2xl font-semibold">{rowCount}</p>
          <p className="text-xs text-muted-foreground">Rows ready</p>
        </div>
        <div className="border p-4">
          <AlertCircleIcon className="mb-3 size-4" />
          <p className="text-2xl font-semibold">{errors.length}</p>
          <p className="text-xs text-muted-foreground">Validation errors</p>
        </div>
      </div>
      {errors.length ? (
        <div className="max-h-60 divide-y overflow-y-auto border">
          {errors.slice(0, 100).map((error, index) => (
            <p key={`${error.row}-${error.column}-${index}`} className="p-3 text-xs">
              Row {error.row}, <span className="font-medium">{error.column}</span>: {error.message}
            </p>
          ))}
        </div>
      ) : (
        <p className="border p-4 text-sm">No validation errors found.</p>
      )}
    </div>
  );
}

function PreviewTable({
  rows,
  columns,
}: {
  rows: Array<Record<string, unknown>>;
  columns: string[];
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Showing the first 20 rows.</p>
      <div className="overflow-x-auto border">
        <table className="w-full min-w-max text-left text-xs">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="p-3 font-medium">#</th>
              {columns.map((column) => (
                <th key={column} className="p-3 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.slice(0, 20).map((row, index) => (
              <tr key={index}>
                <td className="p-3 text-muted-foreground">{index + 1}</td>
                {columns.map((column) => (
                  <td key={column} className="max-w-64 truncate p-3">
                    {formatCell(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function restoreMappings(parsed: ParsedDataset, saved: ColumnMapping[]) {
  const defaults = createDefaultMappings(parsed);
  if (!saved.length) return defaults;

  return defaults.map(
    (mapping) => saved.find((candidate) => candidate.source === mapping.source) ?? mapping,
  );
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
