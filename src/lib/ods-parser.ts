import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import {
  CRENEAUX,
  FULL_DAY_START,
  FULL_DAY_END,
  VALID_OPTIONS,
  COMPOUND_OPTION_MAP,
  FRENCH_MONTHS,
  ACADEMIC_YEAR_START,
  ACADEMIC_YEAR_END,
  VACATION_KEYWORDS,
  OPTIONAL_KEYWORDS,
  TARGET_SHEET_NAME,
  MAX_GRID_COLS,
  MAX_GRID_ROWS,
} from "./config";
import type { ScheduleEvent, ParseWarning } from "./types";

export interface GridCell {
  text: string;
  isMergeContinuation: boolean;
  originRow: number;
  originCol: number;
  colspan: number;
  rowspan: number;
}

interface WeekBlock {
  row: number;
  weekNumber: number;
  dates: Record<number, string>;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export class ODSParser {
  warnings: ParseWarning[] = [];
  grid: GridCell[][] = [];
  private weekBlocks: WeekBlock[] = [];

  constructor(private buffer: ArrayBuffer) {}

  async parse(): Promise<ScheduleEvent[]> {
    const sheet = await this.loadSheet();
    const rawRows = this.extractRawRows(sheet);
    this.grid = this.buildGridWithMerges(rawRows);
    this.weekBlocks = this.identifyWeekBlocks();
    const creneauMap = this.buildCreneauMap();
    return this.extractEvents(creneauMap);
  }

  private async loadSheet(): Promise<Record<string, unknown>> {
    const zip = await JSZip.loadAsync(this.buffer);
    const content = await zip.file("content.xml")?.async("text");
    if (!content) throw new Error("Ce fichier n’est pas un ODS valide.");

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      isArray: (name) =>
        ["table:table", "table:table-row", "table:table-cell", "text:p"].includes(name),
    });

    const doc = parser.parse(content);
    const tables = this.findTables(doc);
    const sheet = tables.find(
      (t) => (t["@_table:name"] as string) === TARGET_SHEET_NAME,
    );

    if (!sheet) {
      throw new Error(
        `Feuille « ${TARGET_SHEET_NAME} » introuvable dans ce fichier.`,
      );
    }

    return sheet;
  }

  private findTables(obj: unknown): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const rec = node as Record<string, unknown>;
      for (const [key, val] of Object.entries(rec)) {
        if (key.endsWith("table:table")) {
          const items = Array.isArray(val) ? val : [val];
          results.push(...(items as Record<string, unknown>[]));
        } else {
          walk(val);
        }
      }
    };
    walk(obj);
    return results;
  }

  private getCellText(cell: Record<string, unknown>): string {
    const texts: string[] = [];
    const paragraphs = cell["text:p"];
    const ps = paragraphs
      ? Array.isArray(paragraphs)
        ? paragraphs
        : [paragraphs]
      : [];

    for (const p of ps) {
      if (typeof p === "string") {
        texts.push(p);
      } else if (p && typeof p === "object") {
        const rec = p as Record<string, unknown>;
        if (rec["#text"]) texts.push(String(rec["#text"]));
        for (const v of Object.values(rec)) {
          if (typeof v === "string") texts.push(v);
        }
      }
    }
    return texts.join(" ").trim();
  }

  private extractRawRows(
    sheet: Record<string, unknown>,
  ): { text: string; colspan: number; rowspan: number }[][] {
    const allRows: { text: string; colspan: number; rowspan: number }[][] = [];
    const rowElems = sheet["table:table-row"];
    const rows = rowElems
      ? Array.isArray(rowElems)
        ? rowElems
        : [rowElems]
      : [];

    for (const rowElem of rows as Record<string, unknown>[]) {
      const rowRepeat = parseInt(
        String(rowElem["@_table:number-rows-repeated"] ?? "1"),
        10,
      );

      const cells: { text: string; colspan: number; rowspan: number }[] = [];
      let colPos = 0;

      const cellElems = rowElem["table:table-cell"];
      const cellList = cellElems
        ? Array.isArray(cellElems)
          ? cellElems
          : [cellElems]
        : [];

      for (const cellElem of cellList as Record<string, unknown>[]) {
        const colRepeat = parseInt(
          String(cellElem["@_table:number-columns-repeated"] ?? "1"),
          10,
        );
        const colspan = parseInt(
          String(cellElem["@_table:number-columns-spanned"] ?? "1"),
          10,
        );
        const rowspan = parseInt(
          String(cellElem["@_table:number-rows-spanned"] ?? "1"),
          10,
        );
        const text = this.getCellText(cellElem);

        let effectiveRepeat = colRepeat;
        if (colPos + colRepeat > MAX_GRID_COLS) {
          effectiveRepeat = Math.max(0, MAX_GRID_COLS - colPos);
        }

        for (let i = 0; i < effectiveRepeat; i++) {
          cells.push({ text, colspan, rowspan });
          colPos++;
        }

        if (colPos >= MAX_GRID_COLS) break;
      }

      if (allRows.length < MAX_GRID_ROWS) {
        allRows.push(cells);
      }

      if (rowRepeat > 1) {
        const copies = Math.min(rowRepeat - 1, MAX_GRID_ROWS - allRows.length);
        for (let i = 0; i < copies; i++) {
          allRows.push([{ text: "", colspan: 1, rowspan: 1 }]);
        }
      }

      if (allRows.length >= MAX_GRID_ROWS) break;
    }

    return allRows;
  }

  private buildGridWithMerges(
    rawRows: { text: string; colspan: number; rowspan: number }[][],
  ): GridCell[][] {
    const numRows = Math.min(rawRows.length, MAX_GRID_ROWS);
    const numCols = MAX_GRID_COLS;

    const emptyCell = (r: number, c: number): GridCell => ({
      text: "",
      isMergeContinuation: false,
      originRow: r,
      originCol: c,
      colspan: 1,
      rowspan: 1,
    });

    const grid: GridCell[][] = Array.from({ length: numRows }, (_, r) =>
      Array.from({ length: numCols }, (_, c) => emptyCell(r, c)),
    );

    const occupied: boolean[][] = Array.from({ length: numRows }, () =>
      Array(numCols).fill(false),
    );

    for (let r = 0; r < numRows; r++) {
      const rawRow = rawRows[r] ?? [];
      let logicalCol = 0;

      for (const cell of rawRow) {
        while (logicalCol < numCols && occupied[r][logicalCol]) {
          logicalCol++;
        }
        if (logicalCol >= numCols) break;

        const text = cell.text;
        const colspan = Math.min(cell.colspan, numCols - logicalCol);
        const rowspan = Math.min(cell.rowspan, numRows - r);

        for (let dr = 0; dr < rowspan; dr++) {
          for (let dc = 0; dc < colspan; dc++) {
            const gr = r + dr;
            const gc = logicalCol + dc;
            if (gr < numRows && gc < numCols) {
              occupied[gr][gc] = true;
              grid[gr][gc] = {
                text,
                isMergeContinuation: dr > 0 || dc > 0,
                originRow: r,
                originCol: logicalCol,
                colspan,
                rowspan,
              };
            }
          }
        }

        logicalCol++;
      }
    }

    return grid;
  }

  private identifyWeekBlocks(): WeekBlock[] {
    const blocks: WeekBlock[] = [];

    for (let r = 0; r < this.grid.length; r++) {
      const row = this.grid[r];
      if (!row[0]?.text.trim() || row[0].text.trim() !== "Semaine") continue;

      const weekNumText = row[1]?.text.trim() ?? "";
      const weekNum = parseInt(weekNumText, 10);
      if (isNaN(weekNum)) {
        this.warnings.push({
          row: r,
          col: 1,
          message: `Não foi possível ler semana: '${weekNumText}'`,
          rawText: weekNumText,
        });
        continue;
      }

      const dates: Record<number, string> = {};
      let dayCounter = 0;

      for (const cell of row.slice(2)) {
        if (cell.isMergeContinuation) continue;
        const dateText = cell.text.trim();
        if (dateText) {
          const parsed = this.parseFrenchDate(dateText, r, cell.originCol);
          if (parsed) {
            dates[dayCounter] = parsed;
            dayCounter++;
            if (dayCounter >= 5) break;
          }
        }
      }

      blocks.push({ row: r, weekNumber: weekNum, dates });
    }

    return blocks;
  }

  private parseFrenchDate(text: string, row: number, col: number): string | null {
    const lower = text.trim().toLowerCase();
    if (!lower) return null;

    const match = lower.match(
      /(?:lundi|mardi|mercredi|jeudi|vendredi)\s+(\d{1,2})\s+(\w+)/,
    );
    if (!match) {
      this.warnings.push({
        row,
        col,
        message: `Data inválida: '${text}'`,
        rawText: text,
      });
      return null;
    }

    const day = parseInt(match[1], 10);
    const monthStr = match[2].replace(/\.$/, "");
    const month = FRENCH_MONTHS[monthStr];

    if (!month) {
      this.warnings.push({
        row,
        col,
        message: `Mês desconhecido: '${monthStr}'`,
        rawText: text,
      });
      return null;
    }

    const year = month >= 8 ? ACADEMIC_YEAR_START : ACADEMIC_YEAR_END;

    try {
      const d = new Date(year, month - 1, day);
      if (d.getMonth() !== month - 1) throw new Error("invalid");
      return formatDate(year, month, day);
    } catch {
      this.warnings.push({
        row,
        col,
        message: `Data inválida ${year}-${month}-${day}`,
        rawText: text,
      });
      return null;
    }
  }

  private buildCreneauMap(): Record<string, [number, number]> {
    if (this.grid.length < 4) return {};

    const headerRow = this.grid[3];
    const creneauMap: Record<string, [number, number]> = {};
    let dayIdx = -1;
    const creneauOrder = ["C1", "C2", "C3", "C4"];

    for (let col = 0; col < headerRow.length; col++) {
      const cell = headerRow[col];
      const text = cell.text.trim();
      if (cell.isMergeContinuation) continue;

      if (creneauOrder.includes(text)) {
        if (text === "C1") dayIdx++;
        creneauMap[`${dayIdx},${text}`] = [col, cell.colspan ?? 2];
      }
    }

    return creneauMap;
  }

  private extractEvents(creneauMap: Record<string, [number, number]>): ScheduleEvent[] {
    const events: ScheduleEvent[] = [];

    for (let blockIdx = 0; blockIdx < this.weekBlocks.length; blockIdx++) {
      const block = this.weekBlocks[blockIdx];
      const nextWeekRow =
        blockIdx + 1 < this.weekBlocks.length
          ? this.weekBlocks[blockIdx + 1].row
          : this.grid.length;

      for (let r = block.row + 1; r < nextWeekRow; r++) {
        if (r >= this.grid.length) break;

        const row = this.grid[r];
        const optionLabel = row[0]?.text.trim() ?? "";
        if (!optionLabel || optionLabel === "Semaine") continue;

        const options = this.resolveOptionLabel(optionLabel);

        for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
          if (!(dayIdx in block.dates)) continue;
          const eventDate = block.dates[dayIdx];
          const dayEvents = this.extractDayEvents(
            row,
            r,
            dayIdx,
            eventDate,
            creneauMap,
            options,
            block.weekNumber,
          );
          events.push(...dayEvents);
        }
      }
    }

    return events;
  }

  private extractDayEvents(
    row: GridCell[],
    rowIdx: number,
    dayIdx: number,
    eventDate: string,
    creneauMap: Record<string, [number, number]>,
    options: string[],
    weekNum: number,
  ): ScheduleEvent[] {
    const events: ScheduleEvent[] = [];
    const processedOrigins = new Set<string>();
    const creneauNames = ["C1", "C2", "C3", "C4"];

    for (const creneauName of creneauNames) {
      const key = `${dayIdx},${creneauName}`;
      if (!(key in creneauMap)) continue;

      const [cStart, cSpan] = creneauMap[key];

      for (let colIdx = cStart; colIdx < cStart + cSpan; colIdx++) {
        if (colIdx >= row.length) continue;

        const cell = row[colIdx];
        const text = cell.text.trim();
        if (!text) continue;

        const origin = `${cell.originRow},${cell.originCol}`;
        if (processedOrigins.has(origin)) continue;
        processedOrigins.add(origin);

        let { startTime, endTime, isAllDay } = this.resolveTimeSpan(
          dayIdx,
          colIdx,
          cell.colspan ?? 1,
          creneauMap,
        );

        const timeMatch = text.match(
          /(\d{1,2})h(\d{2})?\s*(?:-|à|a)\s*(\d{1,2})h(\d{2})?/i,
        );
        if (timeMatch) {
          const [, h1, m1, h2, m2] = timeMatch;
          startTime = `${parseInt(h1, 10).toString().padStart(2, "0")}:${m1 ?? "00"}`;
          endTime = `${parseInt(h2, 10).toString().padStart(2, "0")}:${m2 ?? "00"}`;
          isAllDay = false;
        }

        const isVacation = VACATION_KEYWORDS.some((kw) =>
          text.toLowerCase().includes(kw),
        );
        const isOptional = OPTIONAL_KEYWORDS.some((kw) =>
          text.toLowerCase().includes(kw),
        );
        const { subject, eventType } = this.extractEventType(text);

        for (const opt of options) {
          events.push({
            date: eventDate,
            startTime,
            endTime,
            subject,
            eventType,
            option: opt,
            isAllDay,
            isVacation,
            isOptional,
            sourceRow: cell.originRow ?? rowIdx,
            sourceCol: cell.originCol ?? colIdx,
            weekNumber: weekNum,
          });
        }
      }
    }

    return events;
  }

  private resolveTimeSpan(
    dayIdx: number,
    startCol: number,
    colspan: number,
    creneauMap: Record<string, [number, number]>,
  ): { startTime: string; endTime: string; isAllDay: boolean } {
    const eventCols = Array.from({ length: colspan }, (_, i) => startCol + i);
    let minStart = "23:59";
    let maxEnd = "00:00";
    const coveredCreneaux = new Set<string>();

    for (const c of eventCols) {
      for (const creneauName of ["C1", "C2", "C3", "C4"]) {
        const key = `${dayIdx},${creneauName}`;
        if (!(key in creneauMap)) continue;

        const [cStart, cSpan] = creneauMap[key];
        if (c >= cStart && c < cStart + cSpan) {
          coveredCreneaux.add(creneauName);
          const subIdx = c - cStart;
          const [startStr, endStr] = CRENEAUX[creneauName];

          let sTime: string;
          let eTime: string;

          if (cSpan === 2) {
            const halves: Record<string, [string, string][]> = {
              C1: [
                ["08:10", "09:05"],
                ["09:05", "10:00"],
              ],
              C2: [
                ["10:15", "11:15"],
                ["11:15", "12:10"],
              ],
              C3: [
                ["13:35", "14:30"],
                ["14:30", "15:30"],
              ],
              C4: [
                ["15:45", "16:40"],
                ["16:40", "17:35"],
              ],
            };
            [sTime, eTime] = halves[creneauName][subIdx];
          } else {
            const [sh, sm] = startStr.split(":").map(Number);
            const [eh, em] = endStr.split(":").map(Number);
            const startMins = sh * 60 + sm;
            const endMins = eh * 60 + em;
            const duration = (endMins - startMins) / cSpan;
            const subStart = startMins + duration * subIdx;
            const subEnd = startMins + duration * (subIdx + 1);
            sTime = `${Math.floor(subStart / 60).toString().padStart(2, "0")}:${Math.round(subStart % 60).toString().padStart(2, "0")}`;
            eTime = `${Math.floor(subEnd / 60).toString().padStart(2, "0")}:${Math.round(subEnd % 60).toString().padStart(2, "0")}`;
          }

          if (sTime < minStart) minStart = sTime;
          if (eTime > maxEnd) maxEnd = eTime;
          break;
        }
      }
    }

    if (minStart === "23:59" || maxEnd === "00:00") {
      return { startTime: FULL_DAY_START, endTime: FULL_DAY_END, isAllDay: true };
    }

    return {
      startTime: minStart,
      endTime: maxEnd,
      isAllDay: coveredCreneaux.size === 4,
    };
  }

  private resolveOptionLabel(label: string): string[] {
    if (label in COMPOUND_OPTION_MAP) return COMPOUND_OPTION_MAP[label];
    if (VALID_OPTIONS.includes(label as (typeof VALID_OPTIONS)[number])) {
      return [label];
    }
    return [label];
  }

  private extractEventType(text: string): { subject: string; eventType: string } {
    let eventType = "";
    let subject = text;

    for (const marker of ["CE", "BE"]) {
      const pattern = new RegExp(`\\b${marker}\\b`);
      if (pattern.test(text)) {
        eventType = marker;
        subject = text.replace(new RegExp(`\\s*\\b${marker}\\b\\s*(noté\\s*)?`, "i"), " ").trim();
        break;
      }
    }

    if (!eventType) {
      for (const marker of ["TP", "Amphi"]) {
        if (text.startsWith(`${marker} `)) {
          eventType = marker;
          subject = text.slice(marker.length + 1).trim();
          break;
        }
        if (text.endsWith(` ${marker}`)) {
          eventType = marker;
          subject = text.slice(0, -(marker.length + 1)).trim();
          break;
        }
      }
    }

    return { subject, eventType };
  }
}

export async function parseOdsFile(
  buffer: ArrayBuffer,
  selectedOption: string,
): Promise<{ events: ScheduleEvent[]; warnings: ParseWarning[]; grid: GridCell[][] }> {
  const parser = new ODSParser(buffer);
  const allEvents = await parser.parse();
  const { filterScheduleForOption } = await import("./event-filter");
  const filtered = filterScheduleForOption(parser.grid, allEvents, selectedOption);
  return { events: filtered, warnings: parser.warnings, grid: parser.grid };
}

export function limitToWeeks(events: ScheduleEvent[], weeks: number): ScheduleEvent[] {
  if (weeks <= 0 || events.length === 0) return events;

  const dates = events.map((e) => e.date).sort();
  const minDate = dates[0];
  const minDay = new Date(minDate + "T12:00:00");
  const dayOfWeek = minDay.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const firstMonday = addDays(minDate, mondayOffset);
  const cutoff = addDays(firstMonday, weeks * 7);

  return events.filter((e) => e.date < cutoff);
}
