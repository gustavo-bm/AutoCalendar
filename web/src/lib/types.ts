export interface ScheduleEvent {
  date: string;
  startTime: string;
  endTime: string;
  subject: string;
  eventType: string;
  option: string;
  isAllDay: boolean;
  isVacation: boolean;
  isOptional: boolean;
  sourceRow: number;
  sourceCol: number;
  weekNumber: number;
}

export interface ParseWarning {
  row: number;
  col: number;
  message: string;
  rawText: string;
}

export interface PreviewEvent extends ScheduleEvent {
  title: string;
}

export interface SyncStats {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  deleted: number;
}

export interface SyncRequest {
  events: ScheduleEvent[];
  calendarName: string;
  confirmBulkDelete?: boolean;
}
