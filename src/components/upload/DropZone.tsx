"use client";

import { useRef, useState, type ChangeEventHandler, type DragEvent, type ReactElement } from "react";
import { DropSeal } from "@/components/DropSeal";
import { MAX_FILE_SIZE_LABEL } from "@/lib/hash";
import { MAX_BATCH_FILES } from "./upload-reducer";

export type FileSource = "drop" | "picker";

export interface DropZoneProps {
  /** What the zone is doing, or null when it is waiting for files. */
  stage: "hashing" | "signing" | null;
  /** e.g. "File 2 of 5", when a batch is being signed. */
  position?: string;
  onFiles: (files: FileList | null, source: FileSource) => void;
}

/**
 * The large drop target, which doubles as a button that opens the file
 * picker. While a batch is running it shows what is happening and ignores
 * clicks; the progress and Cancel controls live outside it.
 */
export function DropZone({ stage, position, onFiles }: DropZoneProps): ReactElement {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busy = stage !== null;
  const stageLabel = stage === "hashing" ? "Hashing" : "Signing";

  const stop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>): void => {
    stop(e);
    if (!busy) setDragActive(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    stop(e);
    // Moving onto a child of the zone fires dragleave too; only a real exit counts.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setDragActive(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    stop(e);
    setDragActive(false);
    // Like a click, a drop mid-batch is ignored: it would discard the files
    // already signed. Cancel first to start again.
    if (busy) return;
    onFiles(e.dataTransfer.files, "drop");
  };

  const openPicker = (): void => {
    inputRef.current?.click();
  };

  const onFileChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    // The caller copies the FileList before its first await, so the input can
    // be cleared right away; that lets choosing the same files again fire change.
    onFiles(e.target.files, "picker");
    e.target.value = "";
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Choose files to sign"
      aria-disabled={busy}
      className={`group flex flex-col items-center gap-5 px-5 py-7 text-center shadow-pressed transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:flex-row sm:gap-8 sm:px-8 sm:py-9 sm:text-left ${
        dragActive ? "bg-tint" : "bg-paper"
      } ${busy ? "cursor-progress" : "cursor-pointer"}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={stop}
      onDrop={handleDrop}
      onClick={busy ? undefined : openPicker}
      onKeyDown={(e) => {
        if (busy) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
      }}
    >
      <input id="fileInput" type="file" multiple ref={inputRef} className="hidden" onChange={onFileChange} />

      <DropSeal
        state={busy ? "busy" : dragActive ? "over" : "idle"}
        rimText={`${busy ? stageLabel : "Unsealed · awaiting a file"} · `.repeat(busy ? 4 : 2)}
      />

      <div className="min-w-0 space-y-2">
        <p className="font-display text-[22px] font-bold uppercase leading-none tracking-[-0.01em] sm:text-[26px]">
          {busy ? `${stageLabel}…` : dragActive ? "Release to sign" : "Drop files to sign them"}
        </p>
        {busy ? (
          // While hashing, the progress region below is the live status.
          <p className="text-mute" role={stage === "signing" ? "status" : undefined}>
            {position ? `${position}. ` : ""}
            {stage === "hashing"
              ? "Reading the file in this browser."
              : "Sending the fingerprint for countersignature."}
          </p>
        ) : (
          <p className="text-mute">
            or{" "}
            <span className="text-accent underline decoration-1 underline-offset-[3px] group-hover:decoration-2">
              choose them from your device
            </span>
          </p>
        )}
        <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-mute">
          Any type · up to {MAX_FILE_SIZE_LABEL} each · {MAX_BATCH_FILES} at a time
        </p>
      </div>
    </div>
  );
}
