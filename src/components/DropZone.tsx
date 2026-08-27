"use client";

import { useState, useCallback } from "react";

interface DropZoneProps {
  onFile: (file: File) => void;
  fileName: string | null;
}

export function DropZone({ onFile, fileName }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file?.name.toLowerCase().endsWith(".ods")) {
        onFile(file);
      }
    },
    [onFile],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  };

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`neon-border flex cursor-pointer flex-col items-center justify-center rounded-2xl bg-[var(--surface)] p-10 transition-all ${
        dragging ? "drop-zone-active" : ""
      }`}
    >
      <input
        type="file"
        accept=".ods"
        onChange={handleChange}
        className="hidden"
      />

      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--neon)"
        strokeWidth="1.5"
        className="mb-4 opacity-80"
      >
        <path d="M12 16V4m0 0L8 8m4-4 4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      </svg>

      {fileName ? (
        <p className="text-sm font-medium">{fileName}</p>
      ) : (
        <>
          <p className="text-base font-medium">
            Déposez le fichier <span className="neon-text">.ods</span> ici
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            ou cliquez pour le choisir
          </p>
        </>
      )}
    </label>
  );
}
