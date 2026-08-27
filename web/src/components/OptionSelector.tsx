"use client";

import { VALID_OPTIONS } from "@/lib/config";

interface OptionSelectorProps {
  value: string;
  onChange: (option: string) => void;
}

export function OptionSelector({ value, onChange }: OptionSelectorProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {VALID_OPTIONS.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
            value === opt
              ? "bg-[var(--neon)] text-white shadow-[0_0_16px_var(--neon-glow)]"
              : "neon-border bg-[var(--surface-2)] text-[var(--muted)] hover:text-white"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
