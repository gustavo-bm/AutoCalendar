"use client";

import type { PreviewEvent } from "@/lib/types";

interface PreviewTableProps {
  events: PreviewEvent[];
}

export function PreviewTable({ events }: PreviewTableProps) {
  const display = events.filter((e) => !e.isVacation).slice(0, 50);

  if (display.length === 0) return null;

  const total = events.filter((e) => !e.isVacation).length;

  return (
    <div className="neon-border overflow-hidden rounded-2xl bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-5 py-3">
        <h3 className="text-sm font-semibold">
          Aperçu — {total} cours
          {total > 50 && " (50 premiers)"}
        </h3>
      </div>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[var(--surface-2)] text-[var(--muted)]">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Horaire</th>
              <th className="px-4 py-2 font-medium">Matière</th>
            </tr>
          </thead>
          <tbody>
            {display.map((e, i) => (
              <tr
                key={`${e.date}-${e.startTime}-${e.subject}-${i}`}
                className="border-t border-[var(--border)]/50 hover:bg-[var(--surface-2)]"
              >
                <td className="whitespace-nowrap px-4 py-2">{e.date}</td>
                <td className="whitespace-nowrap px-4 py-2 text-[var(--muted)]">
                  {e.startTime}–{e.endTime}
                </td>
                <td className="px-4 py-2">{e.title}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
