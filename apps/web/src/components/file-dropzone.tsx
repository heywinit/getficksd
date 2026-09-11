import { Button } from "@getficksd/ui/components/button";
import { cn } from "@getficksd/ui/lib/utils";
import { FileUpIcon, UploadCloudIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";

type FileDropzoneProps = {
  accept?: string;
  disabled?: boolean;
  multiple?: boolean;
  onSelect: (files: File[]) => void;
};

export function FileDropzone({ accept, disabled, multiple = true, onSelect }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  function selectFiles(fileList: FileList | null) {
    if (fileList?.length) {
      onSelect(Array.from(fileList));
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-52 flex-col items-center justify-center gap-3 border border-dashed p-6 text-center transition-colors",
        isDragging && "border-primary bg-muted/50",
        disabled && "pointer-events-none opacity-50",
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setIsDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        selectFiles(event.dataTransfer.files);
      }}
    >
      <div className="flex size-10 items-center justify-center border bg-background">
        {isDragging ? <FileUpIcon /> : <UploadCloudIcon />}
      </div>
      <div>
        <p className="text-sm font-medium">Drop files here</p>
        <p className="mt-1 text-xs text-muted-foreground">Or choose files from your device.</p>
      </div>
      <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
        Choose files
      </Button>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          selectFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}

type UploadProgressProps = {
  name: string;
  progress: number;
  status: "uploading" | "complete" | "error";
  onDismiss?: () => void;
};

export function UploadProgress({ name, progress, status, onDismiss }: UploadProgressProps) {
  return (
    <div className="border p-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-xs font-medium">{name}</p>
        <span className="text-xs capitalize text-muted-foreground">{status}</span>
        {status !== "uploading" && onDismiss ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Dismiss ${name}`}
            onClick={onDismiss}
          >
            <XIcon />
          </Button>
        ) : null}
      </div>
      <div className="h-1 overflow-hidden bg-muted">
        <div
          className={cn(
            "h-full bg-primary transition-[width]",
            status === "error" && "bg-destructive",
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
