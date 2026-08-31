"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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

/* ─── sessionStorage persistence ─── */

const STORAGE_KEY = "autocalendar_state";

interface PersistedState {
  events: ScheduleEvent[];
  calendarName: string;
  option: string;
  fileName: string | null;
}

function persistState(data: PersistedState) {
  try {
    const json = JSON.stringify(data);
    sessionStorage.setItem(STORAGE_KEY, json);
    console.log(`[AutoCalendar] persisted ${data.events.length} events (${json.length} chars)`);
  } catch (e) {
    console.error("[AutoCalendar] persistState failed:", e);
  }
}

function loadPersistedState(): PersistedState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed.events?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPersistedState() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/* ─── Component ─── */

export default function Home() {
  const { data: session } = useSession();

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

  // Use a ref to always have the latest events available for sync,
  // avoiding stale-closure issues with async operations.
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const calendarNameRef = useRef(calendarName);
  calendarNameRef.current = calendarName;

  // On mount: restore events from sessionStorage if they exist.
  // This handles the case where the user was redirected to OAuth
  // and lost React state.
  const didRestore = useRef(false);
  useEffect(() => {
    if (didRestore.current) return;
    didRestore.current = true;

    const raw = sessionStorage.getItem(STORAGE_KEY);
    console.log("[AutoCalendar] restore check — raw in sessionStorage:", raw ? `${raw.length} chars` : "null");

    const saved = loadPersistedState();
    if (!saved) {
      console.log("[AutoCalendar] nothing to restore");
      return;
    }

    console.log(`[AutoCalendar] restoring ${saved.events.length} events, calendar: ${saved.calendarName}`);
    setEvents(saved.events);
    setPreview(
      saved.events.map((e) => ({ ...e, title: classifyEventTitle(e) })),
    );
    setCalendarName(saved.calendarName);
    setOption(saved.option);
    setFileName(saved.fileName);
    setStep("preview");
  }, []);

  /* ─── Handlers ─── */

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

        // Persist so it survives OAuth redirects
        persistState({
          events: filtered,
          calendarName,
          option,
          fileName: file.name,
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Impossible de lire le fichier ODS.",
        );
      } finally {
        setLoading(false);
      }
    },
    [option, weekLimit, calendarName],
  );

  const doSync = async (
    eventsToSync: ScheduleEvent[],
    calName: string,
    confirmBulkDelete: boolean,
  ) => {
    setStep("syncing");
    setError(null);
    setBulkDeletePending(false);

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: eventsToSync,
          calendarName: calName,
          confirmBulkDelete,
        }),
      });

      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch {
        throw new Error(
          `Le serveur a répondu avec le statut ${res.status}. Vérifiez la configuration.`,
        );
      }

      // Auth error → save state and re-login
      if (res.status === 401) {
        persistState({
          events: eventsToSync,
          calendarName: calName,
          option,
          fileName,
        });
        signIn("google", { callbackUrl: "/" });
        return;
      }

      if (res.status === 409 && data.error === "bulk_delete") {
        setBulkDeletePending(true);
        setStep("preview");
        setError(data.message as string);
        return;
      }

      if (!res.ok) {
        throw new Error(
          (data.error as string) ??
            `Erreur ${res.status} lors de la synchronisation.`,
        );
      }

      clearPersistedState();
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
    // Read from refs to guarantee fresh values
    const currentEvents = eventsRef.current;
    const currentCalendarName = calendarNameRef.current;

    if (!session?.accessToken) {
      // Save state before OAuth redirect
      persistState({
        events: currentEvents,
        calendarName: currentCalendarName,
        option,
        fileName,
      });
      signIn("google", { callbackUrl: "/" });
      return;
    }

    await doSync(currentEvents, currentCalendarName, confirmBulkDelete);
  };

  const reset = () => {
    setStep("upload");
    setFileName(null);
    setEvents([]);
    setPreview([]);
    setStats(null);
    setError(null);
    setBulkDeletePending(false);
    clearPersistedState();
  };

  /* ─── Render ─── */

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
              Nombre de semaines (0 = toute l&apos;année) — pour tester
            </label>
            <input
              type="number"
              min={0}
              max={52}
              value={weekLimit}
              onChange={(e) =>
                setWeekLimit(parseInt(e.target.value, 10) || 0)
              }
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
          <h2 className="mt-3 text-xl font-bold neon-text">
            C&apos;est fait !
          </h2>
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
        Le fichier ODS reste sur votre ordinateur. Il n&apos;est pas envoyé
        sur nos serveurs.
      </footer>
    </main>
  );
}
