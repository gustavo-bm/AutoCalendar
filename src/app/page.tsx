"use client";

import { useState, useCallback, useEffect } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { DropZone } from "@/components/DropZone";
import { OptionSelector } from "@/components/OptionSelector";
import { PreviewTable } from "@/components/PreviewTable";
import { SafetyTooltip } from "@/components/SafetyTooltip";
import { parseOdsFile, limitToWeeks } from "@/lib/ods-parser";
import { classifyEventTitle } from "@/lib/event-filter";
import { CALENDAR_NAME_TEMPLATE } from "@/lib/config";
import type { ScheduleEvent, PreviewEvent, SyncStats } from "@/lib/types";

const SHAREPOINT_URL =
  "https://enstafr.sharepoint.com/:x:/r/sites/ENSTAConnect-Planif/_layouts/15/Doc.aspx?sourcedoc=%7B90A49473-DC90-4984-AB25-B714C6EEE6BA%7D&file=2026-2027%20-%20Planification%20des%20cours%20Brest.xlsx&action=default&mobileredirect=true&DefaultItemOpen=1";

type Step = "upload" | "preview" | "syncing" | "done";

const STORAGE_KEY = "autocalendar_pending_sync";

/** Save parsed events to sessionStorage so they survive OAuth redirects. */
function savePendingSync(data: {
  events: ScheduleEvent[];
  calendarName: string;
  option: string;
  fileName: string | null;
}) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* quota exceeded — ignore */
  }
}

/** Restore pending sync data after an OAuth redirect. */
function loadPendingSync(): {
  events: ScheduleEvent[];
  calendarName: string;
  option: string;
  fileName: string | null;
} | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearPendingSync() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export default function Home() {
  const { data: session, status: sessionStatus } = useSession();

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string | null>(null);
  const [option, setOption] = useState("CSN");
  const [calendarName, setCalendarName] = useState(
    CALENDAR_NAME_TEMPLATE.replace("{option}", "CSN"),
  );
  const [weekLimit, setWeekLimit] = useState(0);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [preview, setPreview] = useState<PreviewEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [bulkDeletePending, setBulkDeletePending] = useState(false);
  const [autoSyncPending, setAutoSyncPending] = useState(false);

  // Restore state after OAuth redirect
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;

    const pending = loadPendingSync();
    if (!pending || !pending.events.length) return;

    // Restore the parsed events
    setEvents(pending.events);
    setPreview(
      pending.events.map((e) => ({ ...e, title: classifyEventTitle(e) })),
    );
    setCalendarName(pending.calendarName);
    setOption(pending.option);
    setFileName(pending.fileName);
    setStep("preview");
    setAutoSyncPending(true);
  }, [sessionStatus]);

  // Auto-sync after restoring from OAuth redirect
  useEffect(() => {
    if (!autoSyncPending || !session?.accessToken || events.length === 0) return;
    setAutoSyncPending(false);
    clearPendingSync();
    handleSyncInternal(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSyncPending, session?.accessToken, events]);

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
        setStep("preview");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Impossible de lire le fichier ODS.",
        );
      } finally {
        setLoading(false);
      }
    },
    [option, weekLimit],
  );

  const handleSyncInternal = async (confirmBulkDelete: boolean) => {
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

      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch {
        throw new Error(
          `Le serveur a répondu avec le statut ${res.status}. Vérifiez la configuration du déploiement.`,
        );
      }

      // Auth error → save state and re-login
      if (res.status === 401) {
        savePendingSync({ events, calendarName, option, fileName });
        signIn("google");
        return;
      }

      if (res.status === 409 && data.error === "bulk_delete") {
        setBulkDeletePending(true);
        setStep("preview");
        setError(data.message as string);
        return;
      }

      if (!res.ok) {
        throw new Error((data.error as string) ?? `Erreur ${res.status} lors de la synchronisation.`);
      }

      clearPendingSync();
      setStats(data.stats as SyncStats);
      setStep("done");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Échec de la synchronisation.",
      );
      setStep("preview");
    }
  };

  const handleSync = async (confirmBulkDelete = false) => {
    if (!session?.accessToken) {
      // Save state before redirecting to OAuth
      savePendingSync({ events, calendarName, option, fileName });
      signIn("google");
      return;
    }

    if (events.length === 0) {
      setError(
        "Aucun cours en mémoire. Veuillez ré-importer le fichier ODS avant de synchroniser.",
      );
      return;
    }

    await handleSyncInternal(confirmBulkDelete);
  };

  const reset = () => {
    setStep("upload");
    setFileName(null);
    setEvents([]);
    setPreview([]);
    setStats(null);
    setError(null);
    setBulkDeletePending(false);
    clearPendingSync();
  };

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-10">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="neon-text">Auto</span>Calendar
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Emploi du temps ENSTA Bretagne FISE 2A → Google Agenda
        </p>
        <div className="mt-3 flex items-center justify-center gap-4">
          <SafetyTooltip />
          {session ? (
            <button
              onClick={() => signOut()}
              className="text-xs text-[var(--muted)] hover:text-white"
            >
              {session.user?.email} · Déconnexion
            </button>
          ) : null}
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
          {bulkDeletePending && (
            <button
              onClick={() => handleSync(true)}
              className="ml-3 font-semibold text-red-200 underline"
            >
              Confirmer la suppression
            </button>
          )}
        </div>
      )}

      {(step === "upload" || step === "preview") && (
        <div className="space-y-6">
          <section>
            <label className="mb-2 block text-sm font-medium text-[var(--muted)]">
              Votre option
            </label>
            <OptionSelector value={option} onChange={handleOptionChange} />
          </section>

          <section>
            <label className="mb-2 block text-sm font-medium text-[var(--muted)]">
              Nom du calendrier
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
              Nombre de semaines (0 = toute l'année) — pour tester
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
            <>
              <p className="text-sm leading-relaxed text-[var(--muted)]">
                Téléchargez le fichier{" "}
                <strong className="text-white">entier</strong> de la
                planification SharePoint, au format{" "}
                <strong className="text-white">ODS</strong> (Fichier →
                Télécharger → OpenDocument Spreadsheet) :
              </p>
              <a
                href={SHAREPOINT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-[var(--neon)] underline break-all"
              >
                Planification des cours Brest 2026-2027 (SharePoint)
              </a>
              <DropZone onFile={handleFile} fileName={fileName} />
            </>
          )}

          {loading && (
            <p className="pulse-neon rounded-lg py-3 text-center text-sm text-[var(--neon)]">
              Lecture du fichier…
            </p>
          )}

          {step === "preview" && (
            <>
              <PreviewTable events={preview} />

              <div className="flex gap-3">
                <button onClick={reset} className="neon-btn-outline flex-1">
                  Retour
                </button>
                <button
                  onClick={() => handleSync()}
                  className="neon-btn flex-1"
                >
                  {session
                    ? "Synchroniser"
                    : "Se connecter à Google et synchroniser"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {step === "syncing" && (
        <div className="py-20 text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[var(--neon)] border-t-transparent" />
          <p className="text-sm text-[var(--muted)]">
            Synchronisation avec Google Agenda…
          </p>
        </div>
      )}

      {step === "done" && stats && (
        <div className="neon-border rounded-2xl bg-[var(--surface)] p-8 text-center">
          <p className="text-2xl">✅</p>
          <h2 className="mt-3 text-xl font-bold neon-text">C'est fait !</h2>
          <div className="mt-4 space-y-1 text-sm text-[var(--muted)]">
            <p>
              {stats.created} créés · {stats.updated} mis à jour
            </p>
            {stats.deleted > 0 && (
              <p>{stats.deleted} anciens cours supprimés</p>
            )}
            {stats.errors > 0 && (
              <p className="text-red-400">{stats.errors} erreurs</p>
            )}
          </div>
          <p className="mt-4 text-xs text-[var(--muted)]">
            Calendrier :{" "}
            <strong className="text-white">{calendarName}</strong>
          </p>
          <button onClick={reset} className="neon-btn mt-6">
            Recommencer
          </button>
        </div>
      )}

      <footer className="mt-16 text-center text-xs text-[var(--muted)]">
        Le fichier ODS reste sur votre ordinateur. Il n'est pas envoyé sur nos
        serveurs.
      </footer>
    </main>
  );
}
