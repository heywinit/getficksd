import { Button } from "@getficksd/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@getficksd/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@getficksd/ui/components/dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DatabaseIcon, FileIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DatasetWorkbench } from "@/components/dataset-workbench";
import { FileDropzone, UploadProgress } from "@/components/file-dropzone";
import { EmptyState, ErrorState, LoadingState } from "@/components/page-state";
import type { ColumnMapping } from "@/lib/datasets";
import { useTRPC } from "@/utils/trpc";

type PendingUpload = {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "complete" | "error";
};

export const Route = createFileRoute("/_auth/datasets")({
  component: DatasetsPage,
});

function DatasetsPage() {
  const trpc = useTRPC();
  const files = useQuery(trpc.files.list.queryOptions());
  const datasets = useQuery(trpc.datasets.list.queryOptions());
  const createUpload = useMutation(trpc.files.createUpload.mutationOptions());
  const completeUpload = useMutation(trpc.files.completeUpload.mutationOptions());
  const removeFile = useMutation(trpc.files.remove.mutationOptions());
  const loadDataset = useMutation(trpc.datasets.load.mutationOptions());
  const removeDataset = useMutation(trpc.datasets.remove.mutationOptions());
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);

  function updateUpload(id: string, update: Partial<PendingUpload>) {
    setUploads((current) =>
      current.map((upload) => (upload.id === id ? { ...upload, ...update } : upload)),
    );
  }

  async function uploadFile(file: File) {
    const localId = crypto.randomUUID();
    setUploads((current) => [
      ...current,
      { id: localId, name: file.name, progress: 0, status: "uploading" },
    ]);

    try {
      const upload = await createUpload.mutateAsync({
        name: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      });

      await putFile(upload.uploadUrl, file, (progress) => updateUpload(localId, { progress }));
      await completeUpload.mutateAsync({ id: upload.id });
      updateUpload(localId, { progress: 100, status: "complete" });
      return upload.id;
    } catch (error) {
      updateUpload(localId, { status: "error" });
      throw error;
    }
  }

  async function uploadFiles(selectedFiles: File[]) {
    const results = await Promise.allSettled(selectedFiles.map(uploadFile));
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") {
      toast.error(failure.reason instanceof Error ? failure.reason.message : "Upload failed.");
    }

    await files.refetch();
  }

  async function importDataset(input: {
    file: File;
    name: string;
    columns: ColumnMapping[];
    rows: Array<Record<string, unknown>>;
  }) {
    try {
      const sourceFileId = await uploadFile(input.file);
      const result = await loadDataset.mutateAsync({
        name: input.name,
        sourceFileId,
        columns: input.columns,
        rows: input.rows,
      });

      await Promise.all([files.refetch(), datasets.refetch()]);
      setWorkbenchOpen(false);
      toast.success(
        `Loaded ${result.rowCount} rows${result.errorCount ? ` with ${result.errorCount} errors` : ""}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dataset import failed.";
      toast.error(message);
      throw error;
    }
  }

  async function remove(id: string) {
    const response = await removeFile.mutateAsync({ id });
    if (response.removed) {
      toast.success("File removed.");
      await files.refetch();
    }
  }

  async function removeLoadedDataset(id: string) {
    const response = await removeDataset.mutateAsync({ id });
    if (response.removed) {
      toast.success("Dataset removed.");
      await datasets.refetch();
    }
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Datasets</h1>
        <p className="text-sm text-muted-foreground">
          Upload CSV, XLSX, or JSON files for the data workbench.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Data ingestion workbench</CardTitle>
          <CardDescription>Map, validate, preview, and load structured data.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={() => setWorkbenchOpen(true)}>
            <PlusIcon />
            Import dataset
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <FileDropzone
            accept=".csv,.xlsx,.json,text/csv,application/json"
            disabled={createUpload.isPending || completeUpload.isPending}
            onSelect={uploadFiles}
          />
          {uploads.length ? (
            <div className="mt-3 grid gap-2">
              {uploads.map((upload) => (
                <UploadProgress
                  key={upload.id}
                  {...upload}
                  onDismiss={() =>
                    setUploads((current) => current.filter((item) => item.id !== upload.id))
                  }
                />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Loaded datasets</CardTitle>
          <CardDescription>
            {datasets.data?.length ?? 0} queryable datasets in the active workspace
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {datasets.isError ? (
            <ErrorState error={datasets.error} onRetry={() => void datasets.refetch()} />
          ) : datasets.isLoading ? (
            <LoadingState label="Loading datasets" rows={2} />
          ) : datasets.data?.length ? (
            datasets.data.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-6 py-3">
                <DatabaseIcon className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.rowCount} rows · {item.columns.length} columns · {item.errorCount} errors
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${item.name}`}
                  disabled={removeDataset.isPending}
                  onClick={() => removeLoadedDataset(item.id)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))
          ) : (
            <EmptyState
              title="No loaded datasets"
              description="Import a structured file to create your first dataset."
              icon={DatabaseIcon}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Uploaded files</CardTitle>
          <CardDescription>{files.data?.length ?? 0} files in the active workspace</CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {files.isError ? (
            <ErrorState error={files.error} onRetry={() => void files.refetch()} />
          ) : files.isLoading ? (
            <LoadingState label="Loading files" rows={2} />
          ) : files.data?.length ? (
            files.data.map((file) => (
              <div key={file.id} className="flex items-center gap-3 px-6 py-3">
                <FileIcon className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.size)} · {file.status}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${file.name}`}
                  disabled={removeFile.isPending}
                  onClick={() => remove(file.id)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))
          ) : (
            <EmptyState
              title="No uploaded files"
              description="Drop a CSV, XLSX, or JSON file above."
              icon={FileIcon}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={workbenchOpen} onOpenChange={setWorkbenchOpen}>
        <DialogContent className="top-4 max-h-[calc(100vh-2rem)] max-w-6xl overflow-y-auto p-5">
          <div>
            <DialogTitle>Import dataset</DialogTitle>
            <DialogDescription className="mt-1">
              Your mapping draft is saved in this browser while you work.
            </DialogDescription>
          </div>
          <DatasetWorkbench onLoad={importDataset} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function putFile(url: string, file: File, onProgress: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${request.status}.`));
      }
    });
    request.addEventListener("error", () => reject(new Error("Upload failed.")));
    request.send(file);
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
