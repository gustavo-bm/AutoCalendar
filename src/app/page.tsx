"use client";

import { useState, useCallback } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { DropZone } from "@/components/DropZone";
import { OptionSelector } from "@/components/OptionSelector";
import { PreviewTable } from "@/components/PreviewTable";
import { SafetyTooltip } from "@/components/SafetyTooltip";
import { parseOdsFile, limitToWeeks } from "@/lib/ods-parser";
import { classifyEventTitle } from "@/lib/event-filter";
import { CALENDAR_NAME_TEMPLATE } from "@/lib/config";
import type { ScheduleEvent, PreviewEvent, SyncStats } from "@/lib/types";

type Step = "upload" | "preview" | "syncing" | "done";

export default function Home() {
  const { data: session } = useSession();

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string | null>(null);
  const [option, setOption] = useState("ROB");
  const [calendarName, setCalendarName] = useState(
    CALENDAR_NAME_TEMPLATE.replace("{option}", "ROB"),
  );
  const [weekLimit, setWeekLimit] = useState(0);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [preview, setPreview] = useState<PreviewEvent[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [bulkDeletePending, setBulkDeletePending] = useState(false);

  const handleOptionChange = (opt: string) => {
    setOption(opt);
    setCalendarName(CALENDAR_NAME_TEMPLATE.replace("{option}", opt));
  };

  const handleFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setError(null);
      setFileName(file.name);

      try {
        const buffer = await file.arrayBuffer();
        const result = await parseOdsFile(buffer, option);
        let filtered = result.events;

        if (weekLimit > 0) {
          filtered = limitToWeeks(filtered, weekLimit);
        }

        setEvents(filtered);
        setPreview(
          filtered.map((e) => ({ ...e, title: classifyEventTitle(e) })),
        );
        setWarnings(result.warnings.map((w) => `Linha ${w.row}: ${w.message}`));
        setStep("preview");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao ler ODS");
      } finally {
        setLoading(false);
      }
    },
    [option, weekLimit],
  );

  const handleSync = async (confirmBulkDelete = false) => {
    if (!session?.accessToken) {
      signIn("google");
      return;
    }

    setStep("syncing");
    setError(null);
    setBulkDeletePending(false);

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events,
          calendarName,
          confirmBulkDelete,
        }),
      });

      const data = await res.json();

      if (res.status === 409 && data.error === "bulk_delete") {
        setBulkDeletePending(true);
        setStep("preview");
        setError(data.message);
        return;
      }

      if (!res.ok) {
        throw new Error(data.error ?? "Erro na sincronização");
      }

      setStats(data.stats);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro na sincronização");
      setStep("preview");
    }
  };

  const reset = () => {
    setStep("upload");
    setFileName(null);
    setEvents([]);
    setPreview([]);
    setWarnings([]);
    setStats(null);
    setError(null);
    setBulkDeletePending(false);
  };

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-10">
      {/* Header */}
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="neon-text">Auto</span>Calendar
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          ENSTA Bretagne FISE 2A → Google Calendar
        </p>
        <div className="mt-3 flex items-center justify-center gap-4">
          <SafetyTooltip />
          {session ? (
            <button
              onClick={() => signOut()}
              className="text-xs text-[var(--muted)] hover:text-white"
            >
              {session.user?.email} · Sair
            </button>
          ) : null}
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
          {bulkDeletePending && (
            <button
              onClick={() => handleSync(true)}
              className="ml-3 font-semibold text-red-200 underline"
            >
              Confirmar remoção
            </button>
          )}
        </div>
      )}

      {/* Step: Upload */}
      {(step === "upload" || step === "preview") && (
        <div className="space-y-6">
          <section>
            <label className="mb-2 block text-sm font-medium text-[var(--muted)]">
              Sua opção
            </label>
            <OptionSelector value={option} onChange={handleOptionChange} />
          </section>

          <section>
            <label className="mb-2 block text-sm font-medium text-[var(--muted)]">
              Nome do calendário
            </label>
            <input
              type="text"
              value={calendarName}
              onChange={(e) => setCalendarName(e.target.value)}
              className="neon-border w-full rounded-xl bg-[var(--surface)] px-4 py-3 text-sm outline-none focus:shadow-[0_0_16px_var(--neon-glow)]"
            />
          </section>

          <section>
            <label className="mb-2 block text-sm font-medium text-[var(--muted)]">
              Limite de semanas (0 = todas) — ideal para testar
            </label>
            <input
              type="number"
              min={0}
              max={52}
              value={weekLimit}
              onChange={(e) => setWeekLimit(parseInt(e.target.value, 10) || 0)}
              className="neon-border w-24 rounded-xl bg-[var(--surface)] px-4 py-3 text-sm outline-none"
            />
          </section>

          {step === "upload" && (
            <DropZone onFile={handleFile} fileName={fileName} />
          )}

          {loading && (
            <p className="text-center text-sm text-[var(--neon)] pulse-neon rounded-lg py-3">
              Processando planificação...
            </p>
          )}

          {step === "preview" && (
            <>
              <PreviewTable events={preview} />

              {warnings.length > 0 && (
                <details className="text-xs text-[var(--muted)]">
                  <summary className="cursor-pointer">
                    {warnings.length} avisos de parse
                  </summary>
                  <ul className="mt-2 max-h-24 overflow-auto">
                    {warnings.slice(0, 10).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="flex gap-3">
                <button onClick={reset} className="neon-btn-outline flex-1">
                  Voltar
                </button>
                <button
                  onClick={() => handleSync()}
                  className="neon-btn flex-1"
                >
                  {session ? "Sincronizar" : "Conectar Google e Sincronizar"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step: Syncing */}
      {step === "syncing" && (
        <div className="py-20 text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[var(--neon)] border-t-transparent" />
          <p className="text-sm text-[var(--muted)]">
            Sincronizando com Google Calendar...
          </p>
        </div>
      )}

      {/* Step: Done */}
      {step === "done" && stats && (
        <div className="neon-border rounded-2xl bg-[var(--surface)] p-8 text-center">
          <p className="text-2xl">✅</p>
          <h2 className="mt-3 text-xl font-bold neon-text">Sincronizado!</h2>
          <div className="mt-4 space-y-1 text-sm text-[var(--muted)]">
            <p>{stats.created} criados · {stats.updated} atualizados</p>
            {stats.deleted > 0 && <p>{stats.deleted} obsoletos removidos</p>}
            {stats.errors > 0 && (
              <p className="text-red-400">{stats.errors} erros</p>
            )}
          </div>
          <p className="mt-4 text-xs text-[var(--muted)]">
            Calendário: <strong className="text-white">{calendarName}</strong>
          </p>
          <button onClick={reset} className="neon-btn mt-6">
            Novo sync
          </button>
        </div>
      )}

      <footer className="mt-16 text-center text-xs text-[var(--muted)]">
        O arquivo .ods é processado no seu navegador — nunca enviado ao servidor.
      </footer>
    </main>
  );
}
