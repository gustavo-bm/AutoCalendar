import {
  VALID_OPTIONS,
  COMPOUND_OPTION_MAP,
  EVENT_TYPE_MARKERS,
  OPTIONS_PER_WEEK_BLOCK,
} from "./config";
import type { ScheduleEvent } from "./types";
import type { GridCell } from "./ods-parser";

export function filterScheduleForOption(
  grid: GridCell[][],
  events: ScheduleEvent[],
  selectedOption: string,
): ScheduleEvent[] {
  if (!VALID_OPTIONS.includes(selectedOption as (typeof VALID_OPTIONS)[number])) {
    throw new Error(`Option inconnue : ${selectedOption}`);
  }

  const directEvents: ScheduleEvent[] = [];
  const sharedEvents: ScheduleEvent[] = [];
  const seen = new Set<string>();

  const dedupKey = (e: ScheduleEvent) =>
    `${e.date}|${e.startTime}|${e.endTime}|${e.subject}`;

  for (const event of events) {
    const key = dedupKey(event);

    if (event.option === selectedOption) {
      if (!seen.has(key)) {
        seen.add(key);
        directEvents.push(event);
      }
      continue;
    }

    for (const [, members] of Object.entries(COMPOUND_OPTION_MAP)) {
      if (members.includes(selectedOption) && members.includes(event.option)) {
        if (!seen.has(key)) {
          seen.add(key);
          directEvents.push(event);
        }
        break;
      }
    }
  }

  for (const event of events) {
    const key = dedupKey(event);
    if (seen.has(key)) continue;

    const originRow = event.sourceRow;
    const originCol = event.sourceCol;

    if (originRow >= grid.length || originCol >= (grid[originRow]?.length ?? 0)) {
      continue;
    }

    const cell = grid[originRow][originCol];
    const rowspan = cell.rowspan ?? 1;

    if (rowspan >= OPTIONS_PER_WEEK_BLOCK) {
      seen.add(key);
      sharedEvents.push({
        ...event,
        option: "TRONC_COMMUN",
      });
    }
  }

  return [...directEvents, ...sharedEvents].sort((a, b) =>
    a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
  );
}

export function classifyEventTitle(event: ScheduleEvent): string {
  let title = event.subject;

  if (event.eventType) {
    if (event.eventType === "TP" || event.eventType === "Amphi") {
      if (!title.startsWith(event.eventType)) {
        title = `${event.eventType} ${title}`;
      }
    } else if (
      !title.endsWith(`[${event.eventType}]`) &&
      !title.endsWith(event.eventType)
    ) {
      title = `${title} [${event.eventType}]`;
    }
  }

  if (event.isVacation) {
    title = `🏖️ ${title}`;
  }

  return title;
}

export function buildEventDescription(event: ScheduleEvent): string {
  const lines: string[] = [];

  if (event.eventType) {
    const typeDesc = EVENT_TYPE_MARKERS[event.eventType] ?? event.eventType;
    lines.push(`📋 Type: ${typeDesc}`);
  }

  if (event.option !== "TRONC_COMMUN") {
    lines.push(`🎯 Option: ${event.option}`);
  } else {
    lines.push("🎯 Tronc Commun (toutes options)");
  }

  lines.push(`📅 Semaine ${event.weekNumber}`);
  lines.push(`⏰ ${event.startTime} - ${event.endTime}`);

  if (event.isOptional) {
    lines.push("ℹ️ Travail personnel / Autonomie");
  }

  lines.push("", "— Généré par AutoCalendar");
  return lines.join("\n");
}
