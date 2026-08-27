export const CRENEAUX: Record<string, [string, string]> = {
  C1: ["08:10", "10:00"],
  C2: ["10:15", "12:10"],
  C3: ["13:35", "15:30"],
  C4: ["15:45", "17:35"],
};

export const FULL_DAY_START = "08:10";
export const FULL_DAY_END = "17:35";

export const VALID_OPTIONS = [
  "ANO", "MHN", "SP", "AV", "MAMS", "SOIA", "CSN", "ROB", "HYO",
] as const;

export type OptionCode = (typeof VALID_OPTIONS)[number];

export const COMPOUND_OPTION_MAP: Record<string, string[]> = {
  "ANO/MHN": ["ANO", "MHN"],
  ROB1: ["ROB"],
  ROB2: ["ROB"],
};

export const FRENCH_MONTHS: Record<string, number> = {
  janv: 1, janvier: 1,
  févr: 2, février: 2, fevr: 2,
  mars: 3,
  avr: 4, avril: 4,
  mai: 5,
  juin: 6,
  juil: 7, juillet: 7,
  "août": 8, aout: 8,
  sept: 9, septembre: 9,
  oct: 10, octobre: 10,
  nov: 11, novembre: 11,
  "déc": 12, décembre: 12, dec: 12,
};

export const ACADEMIC_YEAR_START = 2026;
export const ACADEMIC_YEAR_END = 2027;

export const EVENT_TYPE_MARKERS: Record<string, string> = {
  CE: "Contrôle / Examen",
  BE: "Bureau d'Études",
  TP: "Travaux Pratiques",
  Amphi: "Amphithéâtre / Aula Magna",
};

export const VACATION_KEYWORDS = [
  "vacances", "férié", "fermeture", "pentecôte", "ascension",
  "toussaint", "armistice", "noël", "noel",
];

export const OPTIONAL_KEYWORDS = ["autonomie", "travail personnel"];

export const TARGET_SHEET_NAME = "FISE_2A";
export const OPTIONS_PER_WEEK_BLOCK = 8;
export const CALENDAR_NAME_TEMPLATE = "ENSTA - FISE2A - {option}";
export const BULK_DELETE_THRESHOLD = 10;

export const MAX_GRID_COLS = 50;
export const MAX_GRID_ROWS = 500;
