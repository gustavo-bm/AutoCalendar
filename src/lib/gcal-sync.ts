import crypto from "crypto";
import { google } from "googleapis";
import { BULK_DELETE_THRESHOLD } from "./config";
import {
  classifyEventTitle,
  buildEventDescription,
} from "./event-filter";
import type { ScheduleEvent, SyncStats } from "./types";

const GOOGLE_EVENT_COLOR_IDS = Array.from({ length: 11 }, (_, i) => String(i + 1));

function generateEventId(event: ScheduleEvent): string {
  const raw = `${event.date}|${event.startTime}|${event.subject}|${event.option}`;
  const hashHex = crypto.createHash("md5").update(raw).digest("hex");
  return `autocalendar${hashHex}`;
}

function getColorIdForEventName(name: string): string {
  if (!name) return "8";
  const hashHex = crypto.createHash("md5").update(name.trim()).digest("hex");
  return GOOGLE_EVENT_COLOR_IDS[parseInt(hashHex, 16) % GOOGLE_EVENT_COLOR_IDS.length];
}

function buildGcalEventBody(event: ScheduleEvent, timezone = "Europe/Paris") {
  const title = classifyEventTitle(event);
  const description = buildEventDescription(event);
  const colorId = getColorIdForEventName(title);

  if (event.isAllDay) {
    return {
      summary: title,
      description,
      colorId,
      start: { date: event.date },
      end: { date: addOneDay(event.date) },
      transparency: event.isOptional ? "transparent" : "opaque",
    };
  }

  return {
    summary: title,
    description,
    colorId,
    start: {
      dateTime: `${event.date}T${event.startTime}:00`,
      timeZone: timezone,
    },
    end: {
      dateTime: `${event.date}T${event.endTime}:00`,
      timeZone: timezone,
    },
    transparency: event.isOptional ? "transparent" : "opaque",
  };
}

function addOneDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function syncToGoogleCalendar(
  accessToken: string,
  calendarName: string,
  events: ScheduleEvent[],
  confirmBulkDelete = false,
): Promise<SyncStats> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: "v3", auth });
  const calendarId = await getOrCreateCalendar(calendar, calendarName);

  const stats: SyncStats = { created: 0, updated: 0, skipped: 0, errors: 0, deleted: 0 };

  for (const event of events) {
    if (event.isVacation) {
      stats.skipped++;
      continue;
    }

    const eventId = generateEventId(event);
    const body = buildGcalEventBody(event);

    try {
      try {
        await calendar.events.get({ calendarId, eventId });
        await calendar.events.update({ calendarId, eventId, requestBody: body });
        stats.updated++;
      } catch (err: unknown) {
        const status = (err as { code?: number }).code;
        if (status === 404) {
          await calendar.events.insert({
            calendarId,
            requestBody: { ...body, id: eventId },
          });
          stats.created++;
        } else {
          throw err;
        }
      }
    } catch {
      stats.errors++;
    }
  }

  stats.deleted = await cleanupStaleEvents(
    calendar,
    calendarId,
    events,
    confirmBulkDelete,
  );

  return stats;
}

async function getOrCreateCalendar(
  calendar: ReturnType<typeof google.calendar>,
  calendarName: string,
): Promise<string> {
  const list = await calendar.calendarList.list();
  const existing = list.data.items?.find((c) => c.summary === calendarName);
  if (existing?.id) return existing.id;

  const created = await calendar.calendars.insert({
    requestBody: {
      summary: calendarName,
      timeZone: "Europe/Paris",
      description: "Emploi du temps généré par AutoCalendar",
    },
  });

  if (!created.data.id) throw new Error("Impossible de créer le calendrier.");
  return created.data.id;
}

async function cleanupStaleEvents(
  calendar: ReturnType<typeof google.calendar>,
  calendarId: string,
  currentEvents: ScheduleEvent[],
  confirmBulkDelete: boolean,
): Promise<number> {
  const currentIds = new Set<string>();
  for (const event of currentEvents) {
    if (!event.isVacation) currentIds.add(generateEventId(event));
  }

  const existingEvents: { id?: string | null }[] = [];
  let pageToken: string | undefined;

  do {
    const result = await calendar.events.list({
      calendarId,
      pageToken,
      maxResults: 2500,
    });
    existingEvents.push(...(result.data.items ?? []));
    pageToken = result.data.nextPageToken ?? undefined;
  } while (pageToken);

  const staleIds = existingEvents
    .map((e) => e.id ?? "")
    .filter((id) => id.startsWith("autocalendar") && !currentIds.has(id));

  if (staleIds.length === 0) return 0;

  if (staleIds.length > BULK_DELETE_THRESHOLD && !confirmBulkDelete) {
    throw new Error(
      `BULK_DELETE:${staleIds.length} eventos obsoletos seriam removidos. Confirme para continuar.`,
    );
  }

  let deleted = 0;
  for (const eid of staleIds) {
    try {
      await calendar.events.delete({ calendarId, eventId: eid });
      deleted++;
    } catch {
      /* skip */
    }
  }

  return deleted;
}
