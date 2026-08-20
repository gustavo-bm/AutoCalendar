"""
Configuration constants for AutoCalendar.

This module centralizes all hardcoded values: time slot definitions,
option/track names, French date vocabulary, and event classification rules.
"""

# ─────────────────────────────────────────────────────────
# Créneaux (time slots) in the spreadsheet
# ─────────────────────────────────────────────────────────
CRENEAUX = {
    "C1": ("08:10", "10:00"),
    "C2": ("10:15", "12:10"),
    "C3": ("13:35", "15:30"),
    "C4": ("15:45", "17:35"),
}

# Full-day fallback when no créneau can be resolved
FULL_DAY_START = "08:10"
FULL_DAY_END = "17:35"

# ─────────────────────────────────────────────────────────
# Valid option/track abbreviations for FISE 2A
# ─────────────────────────────────────────────────────────
VALID_OPTIONS = [
    "ANO", "MHN", "SP", "AV", "MAMS", "SOIA", "CSN", "ROB", "HYO"
]

# Compound labels found in the spreadsheet that map to multiple options
COMPOUND_OPTION_MAP = {
    "ANO/MHN": ["ANO", "MHN"],
    "ROB1": ["ROB"],
    "ROB2": ["ROB"],
}

# ─────────────────────────────────────────────────────────
# French month abbreviations → month number
# ─────────────────────────────────────────────────────────
FRENCH_MONTHS = {
    "janv": 1, "janvier": 1,
    "févr": 2, "février": 2, "fevr": 2,
    "mars": 3,
    "avr": 4, "avril": 4,
    "mai": 5,
    "juin": 6,
    "juil": 7, "juillet": 7,
    "août": 8, "aout": 8,
    "sept": 9, "septembre": 9,
    "oct": 10, "octobre": 10,
    "nov": 11, "novembre": 11,
    "déc": 12, "décembre": 12, "dec": 12,
}

# ─────────────────────────────────────────────────────────
# Academic year extracted from the file title
# The spreadsheet title says "2026 - 2027".
# Weeks 34-53 → year 2026, Weeks 1-20 → year 2027
# ─────────────────────────────────────────────────────────
ACADEMIC_YEAR_START = 2026
ACADEMIC_YEAR_END = 2027
# Weeks with number >= this threshold belong to the START year
WEEK_YEAR_THRESHOLD = 30  # Weeks 30-53 → start year, 1-29 → end year

# ─────────────────────────────────────────────────────────
# Event type markers (French academic abbreviations)
# ─────────────────────────────────────────────────────────
EVENT_TYPE_MARKERS = {
    "CE": "Contrôle / Examen",
    "BE": "Bureau d'Études",
    "TP": "Travaux Pratiques",
    "Amphi": "Amphithéâtre / Aula Magna",
}

# Keywords indicating vacation / no classes
VACATION_KEYWORDS = [
    "vacances", "férié", "fermeture", "pentecôte", "ascension",
    "toussaint", "armistice", "noël", "noel",
]

# Keywords for events that should be treated as optional/lightweight
OPTIONAL_KEYWORDS = [
    "autonomie", "travail personnel",
]

# ─────────────────────────────────────────────────────────
# Sheet layout constants
# ─────────────────────────────────────────────────────────
TARGET_SHEET_NAME = "FISE_2A"

# Number of option rows per week block (ANO/MHN, SP, AV, MAMS, SOIA, CSN, ROB, HYO)
OPTIONS_PER_WEEK_BLOCK = 8

# Column mapping (0-indexed "logical columns" after expanding repeated cells):
# Col 0 = Option label (e.g., "ANO/MHN", "SP", etc.) or "Semaine"
# Col 1 = Week number (in Semaine row) or Semester label (in first option row)
# Cols 2-6 = Day columns (lundi to vendredi in Semaine header)
#   Within each day: 4 créneau sub-columns are interleaved
#   BUT the spreadsheet uses colspan to represent merged cells.
#   The actual logical columns per day are mapped via the header row.

# The header row (row 3) shows: VA, C1, C2, C3, C4, C1, C2, C3, C4, ...
# This tells us the créneau-to-column mapping.

# Google Calendar dedicated calendar name template
CALENDAR_NAME_TEMPLATE = "ENSTA - FISE2A - {option}"

# Google Calendar API scopes
SCOPES = ["https://www.googleapis.com/auth/calendar"]

# OAuth credentials file path
CREDENTIALS_FILE = "credentials.json"
TOKEN_FILE = "token.json"

# Safety threshold for bulk deletion confirmation
BULK_DELETE_THRESHOLD = 10
