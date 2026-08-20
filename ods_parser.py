"""
ODS Spreadsheet Parser for FISE_2A schedule.

Reads the ODS file directly via XML parsing (ODS = ZIP of XML),
extracts the FISE_2A sheet, and builds a structured grid that
correctly handles merged cells (colspan + rowspan).

MEMORY SAFETY: ODS files can declare millions of repeated empty
cells/rows. This parser caps the grid to the actual content area.
"""

import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from dataclasses import dataclass, field
from typing import Optional

from config import (
    CRENEAUX, FULL_DAY_START, FULL_DAY_END,
    VALID_OPTIONS, COMPOUND_OPTION_MAP,
    FRENCH_MONTHS, ACADEMIC_YEAR_START, ACADEMIC_YEAR_END,
    WEEK_YEAR_THRESHOLD, EVENT_TYPE_MARKERS,
    VACATION_KEYWORDS, OPTIONAL_KEYWORDS,
    TARGET_SHEET_NAME, OPTIONS_PER_WEEK_BLOCK,
)

# ODS XML namespaces
NS = {
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
}

TABLE_NS = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"
TEXT_NS = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"

# ─────────────────────────────────────────────────────────
# Hard caps to prevent ODS "fill-to-end" from blowing memory.
# The schedule has 5 days × 4 créneaux = 20 data columns + 2 label cols = ~22.
# We use a generous cap of 50 columns and 500 rows.
# ─────────────────────────────────────────────────────────
MAX_GRID_COLS = 50
MAX_GRID_ROWS = 500


@dataclass
class ScheduleEvent:
    """Represents a single parsed schedule event."""
    date: date
    start_time: str          # "HH:MM"
    end_time: str            # "HH:MM"
    subject: str             # Exact name from the spreadsheet
    event_type: str          # "CE", "TP", "BE", "Amphi", or ""
    option: str              # Which option row this comes from, or "ALL"
    is_all_day: bool = False
    is_vacation: bool = False
    is_optional: bool = False
    source_row: int = 0      # For debug/warning logging
    source_col: int = 0      # For debug/warning logging
    week_number: int = 0


@dataclass
class ParseWarning:
    """Records an ambiguous or unparseable cell for user review."""
    row: int
    col: int
    message: str
    raw_text: str = ""


class ODSParser:
    """
    Parses the FISE_2A sheet from the ODS file and produces
    a list of ScheduleEvent objects.
    """

    def __init__(self, filepath: str):
        self.filepath = filepath
        self.warnings: list[ParseWarning] = []
        self._grid: list[list[dict]] = []
        self._week_blocks: list[dict] = []

    def parse(self) -> list[ScheduleEvent]:
        """Main entry point: parse the ODS file and return events."""
        sheet_element = self._load_sheet()
        raw_rows = self._extract_raw_rows(sheet_element)
        self._grid = self._build_grid_with_merges(raw_rows)
        self._week_blocks = self._identify_week_blocks()
        creneau_map = self._build_creneau_map()
        events = self._extract_events(creneau_map)
        return events

    # ─────────────────────────────────────────────────────
    # Step 1: Load the target sheet from the ODS ZIP
    # ─────────────────────────────────────────────────────
    def _load_sheet(self) -> ET.Element:
        with zipfile.ZipFile(self.filepath, "r") as z:
            with z.open("content.xml") as f:
                tree = ET.parse(f)
                root = tree.getroot()

        for sheet in root.findall(".//table:table", NS):
            name = sheet.get(f"{TABLE_NS}name")
            if name == TARGET_SHEET_NAME:
                return sheet

        raise ValueError(
            f"Sheet '{TARGET_SHEET_NAME}' not found in {self.filepath}. "
            f"Available sheets: {self._list_sheets(root)}"
        )

    def _list_sheets(self, root: ET.Element) -> list[str]:
        return [
            s.get(f"{TABLE_NS}name")
            for s in root.findall(".//table:table", NS)
        ]

    # ─────────────────────────────────────────────────────
    # Step 2: Extract raw cell data from XML rows
    # ─────────────────────────────────────────────────────
    def _get_cell_text(self, cell: ET.Element) -> str:
        """Extract all text content from a cell, joining <text:p> elements."""
        texts = []
        for p in cell.iter(f"{TEXT_NS}p"):
            if p.text:
                texts.append(p.text)
            for child in p:
                if child.text:
                    texts.append(child.text)
                if child.tail:
                    texts.append(child.tail)
        return " ".join(texts).strip()

    def _extract_raw_rows(self, sheet: ET.Element) -> list[list[dict]]:
        """
        Convert XML rows into a list of rows, where each row is a list
        of cell dicts with: text, colspan, rowspan.

        MEMORY SAFETY: Caps column/row repeats to avoid ODS padding
        blowing up memory. Repeated empty cells beyond MAX_GRID_COLS
        are silently discarded.
        """
        all_rows = []
        for row_elem in sheet.findall("table:table-row", NS):
            row_repeat = int(row_elem.get(f"{TABLE_NS}number-rows-repeated", "1"))

            cells = []
            col_pos = 0
            for cell_elem in row_elem.findall("table:table-cell", NS):
                col_repeat = int(cell_elem.get(f"{TABLE_NS}number-columns-repeated", "1"))
                colspan = int(cell_elem.get(f"{TABLE_NS}number-columns-spanned", "1"))
                rowspan = int(cell_elem.get(f"{TABLE_NS}number-rows-spanned", "1"))
                text = self._get_cell_text(cell_elem)

                # Cap: don't expand empty padding cells beyond our limit
                effective_repeat = col_repeat
                if col_pos + col_repeat > MAX_GRID_COLS:
                    effective_repeat = max(0, MAX_GRID_COLS - col_pos)

                for _ in range(effective_repeat):
                    cells.append({
                        "text": text,
                        "colspan": colspan,
                        "rowspan": rowspan,
                    })
                    col_pos += 1

                if col_pos >= MAX_GRID_COLS:
                    break

            # Add the row itself
            if len(all_rows) < MAX_GRID_ROWS:
                all_rows.append(cells)

            # Handle row repeats (blank copies), but capped
            if row_repeat > 1:
                copies_to_add = min(row_repeat - 1, MAX_GRID_ROWS - len(all_rows))
                for _ in range(copies_to_add):
                    all_rows.append([{"text": "", "colspan": 1, "rowspan": 1}])

            if len(all_rows) >= MAX_GRID_ROWS:
                break

        return all_rows

    # ─────────────────────────────────────────────────────
    # Step 3: Build a full grid resolving merged cells
    # ─────────────────────────────────────────────────────
    def _build_grid_with_merges(self, raw_rows: list[list[dict]]) -> list[list[dict]]:
        """
        Creates a 2D grid where merged cells (rowspan/colspan) are
        propagated so every logical position has its content.
        Grid is capped at MAX_GRID_ROWS × MAX_GRID_COLS.
        """
        num_rows = min(len(raw_rows), MAX_GRID_ROWS)
        num_cols = MAX_GRID_COLS

        # Initialize grid with empty cells
        empty_cell = lambda r, c: {
            "text": "", "is_merge_continuation": False,
            "origin_row": r, "origin_col": c,
            "colspan": 1, "rowspan": 1,
        }
        grid = [[empty_cell(r, c) for c in range(num_cols)] for r in range(num_rows)]

        # Track which cells are occupied by a merge
        occupied = [[False] * num_cols for _ in range(num_rows)]

        for r in range(num_rows):
            raw_row = raw_rows[r] if r < len(raw_rows) else []
            logical_col = 0

            for cell in raw_row:
                # Skip columns already occupied by a previous rowspan/colspan
                while logical_col < num_cols and occupied[r][logical_col]:
                    logical_col += 1

                if logical_col >= num_cols:
                    break

                text = cell["text"]
                colspan = min(cell["colspan"], num_cols - logical_col)
                rowspan = min(cell["rowspan"], num_rows - r)

                # Fill the grid for the span of this cell
                for dr in range(rowspan):
                    for dc in range(colspan):
                        gr = r + dr
                        gc = logical_col + dc
                        if gr < num_rows and gc < num_cols:
                            occupied[gr][gc] = True
                            grid[gr][gc] = {
                                "text": text,
                                "is_merge_continuation": (dr > 0 or dc > 0),
                                "origin_row": r,
                                "origin_col": logical_col,
                                "colspan": colspan,
                                "rowspan": rowspan,
                            }

                logical_col += 1

        return grid

    # ─────────────────────────────────────────────────────
    # Step 4: Identify week blocks in the grid
    # ─────────────────────────────────────────────────────
    def _identify_week_blocks(self) -> list[dict]:
        """
        Find all "Semaine" header rows and extract week number + dates.
        Returns a list of week block descriptors.
        """
        blocks = []
        for r, row in enumerate(self._grid):
            if len(row) > 0 and row[0].get("text", "").strip() == "Semaine":
                week_num_text = row[1].get("text", "").strip() if len(row) > 1 else ""
                try:
                    week_num = int(week_num_text)
                except ValueError:
                    self.warnings.append(ParseWarning(
                        row=r, col=1,
                        message=f"Cannot parse week number: '{week_num_text}'",
                        raw_text=week_num_text
                    ))
                    continue

                # Extract dates from columns (lundi to vendredi)
                dates = {}
                day_counter = 0
                # Start looking after the week number (usually from column 2 onwards)
                for cell in row[2:]:
                    if not cell.get("is_merge_continuation", False):
                        date_text = cell.get("text", "").strip()
                        if date_text:
                            parsed_date = self._parse_french_date(date_text, week_num, r, cell.get("origin_col"))
                            if parsed_date:
                                dates[day_counter] = parsed_date
                                day_counter += 1
                                if day_counter >= 5:
                                    break

                blocks.append({
                    "row": r,
                    "week_number": week_num,
                    "dates": dates,  # {0: date_lundi, 1: date_mardi, ...}
                })

        return blocks

    def _parse_french_date(self, text: str, week_num: int,
                           row: int, col: int) -> Optional[date]:
        """
        Parse strings like "lundi 31 août" or "vendredi 01 janv"
        into a proper date object.
        """
        text = text.strip().lower()
        if not text:
            return None

        # Pattern: "jour_semaine DD mois"
        match = re.match(r"(?:lundi|mardi|mercredi|jeudi|vendredi)\s+(\d{1,2})\s+(\w+)", text)
        if not match:
            self.warnings.append(ParseWarning(
                row=row, col=col,
                message=f"Cannot parse date header: '{text}'",
                raw_text=text
            ))
            return None

        day = int(match.group(1))
        month_str = match.group(2).rstrip(".")

        month = FRENCH_MONTHS.get(month_str)
        if month is None:
            self.warnings.append(ParseWarning(
                row=row, col=col,
                message=f"Unknown French month: '{month_str}' in '{text}'",
                raw_text=text
            ))
            return None

        # Determine year based on month instead of week number
        # Academic year starts in August (month 8) and ends in July (month 7)
        if month >= 8:
            year = ACADEMIC_YEAR_START
        else:
            year = ACADEMIC_YEAR_END

        try:
            return date(year, month, day)
        except ValueError as e:
            self.warnings.append(ParseWarning(
                row=row, col=col,
                message=f"Invalid date {year}-{month}-{day}: {e}",
                raw_text=text
            ))
            return None

    # ─────────────────────────────────────────────────────
    # Step 5: Build créneau-to-column mapping from header
    # ─────────────────────────────────────────────────────
    def _build_creneau_map(self) -> dict:
        """
        From the header row (row 3), figure out which grid columns
        correspond to which créneau (C1-C4) for each day (0-4).
        """
        if len(self._grid) < 4:
            return {}

        header_row = self._grid[3]
        creneau_map = {}

        day_idx = -1
        expected_next = "C1"
        creneau_order = ["C1", "C2", "C3", "C4"]

        for col in range(len(header_row)):
            cell = header_row[col]
            text = cell.get("text", "").strip()

            if cell.get("is_merge_continuation", False):
                continue

            if text in creneau_order:
                if text == "C1":
                    day_idx += 1
                creneau_map[(day_idx, text)] = (col, cell.get("colspan", 2))

        return creneau_map

    # ─────────────────────────────────────────────────────
    # Step 6: Extract events from each week block
    # ─────────────────────────────────────────────────────
    def _extract_events(self, creneau_map: dict) -> list[ScheduleEvent]:
        """
        For each week block, iterate through the option rows
        and extract events based on cell content and position.
        """
        events = []

        for block_idx, block in enumerate(self._week_blocks):
            week_row = block["row"]
            week_num = block["week_number"]
            dates = block["dates"]

            if block_idx + 1 < len(self._week_blocks):
                next_week_row = self._week_blocks[block_idx + 1]["row"]
            else:
                next_week_row = len(self._grid)

            option_rows_start = week_row + 1
            option_rows_end = next_week_row

            for r in range(option_rows_start, option_rows_end):
                if r >= len(self._grid):
                    break

                row = self._grid[r]
                if len(row) == 0:
                    continue

                option_label = row[0].get("text", "").strip()
                if not option_label or option_label == "Semaine":
                    continue

                options = self._resolve_option_label(option_label)

                for day_idx in range(5):
                    if day_idx not in dates:
                        continue

                    event_date = dates[day_idx]
                    day_events = self._extract_day_events(
                        row, r, day_idx, event_date, creneau_map,
                        options, week_num
                    )
                    events.extend(day_events)

        return events

    def _extract_day_events(
        self, row: list, row_idx: int, day_idx: int,
        event_date: date, creneau_map: dict,
        options: list[str], week_num: int
    ) -> list[ScheduleEvent]:
        """Extract events for a single day from one option row."""
        events = []
        processed_origins = set()

        for creneau_name in ("C1", "C2", "C3", "C4"):
            key = (day_idx, creneau_name)
            if key not in creneau_map:
                continue

            c_start, c_span = creneau_map[key]

            # Iterate through all columns spanned by this créneau
            for col_idx in range(c_start, c_start + c_span):
                if col_idx >= len(row):
                    continue

                cell = row[col_idx]
                text = cell.get("text", "").strip()

                if not text:
                    continue

                origin = (cell.get("origin_row"), cell.get("origin_col"))
                if origin in processed_origins:
                    continue
                processed_origins.add(origin)

                if cell.get("is_merge_continuation", False) and cell.get("origin_col", col_idx) != col_idx and cell.get("origin_row", row_idx) == row_idx:
                    # We still want to skip horizontal continuations within the same row,
                    # but wait! `processed_origins` handles horizontal continuations perfectly.
                    # We don't need any continuation check here at all!
                    pass

                colspan = cell.get("colspan", 1)
                start_time, end_time, is_all_day = self._resolve_time_span(
                    day_idx, col_idx, colspan, creneau_map
                )

                # Explicit time override if text has "9h00 - 10h30"
                import re
                time_match = re.search(r'(\d{1,2})h(\d{2})?\s*(?:-|à|a)\s*(\d{1,2})h(\d{2})?', text, re.IGNORECASE)
                if time_match:
                    h1, m1, h2, m2 = time_match.groups()
                    m1 = m1 if m1 else "00"
                    m2 = m2 if m2 else "00"
                    start_time = f"{int(h1):02d}:{m1}"
                    end_time = f"{int(h2):02d}:{m2}"
                    is_all_day = False

                is_vacation = any(kw in text.lower() for kw in VACATION_KEYWORDS)
                is_optional = any(kw in text.lower() for kw in OPTIONAL_KEYWORDS)
                subject, event_type = self._extract_event_type(text)

                for opt in options:
                    events.append(ScheduleEvent(
                        date=event_date,
                        start_time=start_time,
                        end_time=end_time,
                        subject=subject,
                        event_type=event_type,
                        option=opt,
                        is_all_day=is_all_day,
                        is_vacation=is_vacation,
                        is_optional=is_optional,
                        source_row=cell.get("origin_row", row_idx),
                        source_col=cell.get("origin_col", col_idx),
                        week_number=week_num,
                    ))

        return events

    def _resolve_time_span(
        self, day_idx: int, start_col: int, colspan: int,
        creneau_map: dict
    ) -> tuple[str, str, bool]:
        """
        Determine start/end time by checking which créneaux overlap with the cell.
        Calculates exact sub-column times for half-blocks.
        """
        event_cols = range(start_col, start_col + colspan)
        
        min_start = "23:59"
        max_end = "00:00"
        
        covered_creneaux = set()

        for c in event_cols:
            for creneau_name in ("C1", "C2", "C3", "C4"):
                key = (day_idx, creneau_name)
                if key in creneau_map:
                    c_start, c_span = creneau_map[key]
                    if c_start <= c < c_start + c_span:
                        covered_creneaux.add(creneau_name)
                        sub_idx = c - c_start
                        
                        start_str, end_str = CRENEAUX[creneau_name]
                        if c_span == 2:
                            # ENSTA exact half-block boundaries
                            if creneau_name == "C1":
                                s_time = "08:10" if sub_idx == 0 else "09:05"
                                e_time = "09:05" if sub_idx == 0 else "10:00"
                            elif creneau_name == "C2":
                                s_time = "10:15" if sub_idx == 0 else "11:15"
                                e_time = "11:15" if sub_idx == 0 else "12:10"
                            elif creneau_name == "C3":
                                s_time = "13:35" if sub_idx == 0 else "14:30"
                                e_time = "14:30" if sub_idx == 0 else "15:30"
                            elif creneau_name == "C4":
                                s_time = "15:45" if sub_idx == 0 else "16:40"
                                e_time = "16:40" if sub_idx == 0 else "17:35"
                            else:
                                start_dt = datetime.strptime(start_str, "%H:%M")
                                end_dt = datetime.strptime(end_str, "%H:%M")
                                duration_mins = (end_dt - start_dt).total_seconds() / 60 / c_span
                                sub_start = start_dt + timedelta(minutes=duration_mins * sub_idx)
                                sub_end = start_dt + timedelta(minutes=duration_mins * (sub_idx + 1))
                                s_time = sub_start.strftime("%H:%M")
                                e_time = sub_end.strftime("%H:%M")
                        else:
                            start_dt = datetime.strptime(start_str, "%H:%M")
                            end_dt = datetime.strptime(end_str, "%H:%M")
                            duration_mins = (end_dt - start_dt).total_seconds() / 60 / c_span
                            sub_start = start_dt + timedelta(minutes=duration_mins * sub_idx)
                            sub_end = start_dt + timedelta(minutes=duration_mins * (sub_idx + 1))
                            s_time = sub_start.strftime("%H:%M")
                            e_time = sub_end.strftime("%H:%M")
                            
                        if s_time < min_start: min_start = s_time
                        if e_time > max_end: max_end = e_time
                        break

        if min_start == "23:59" or max_end == "00:00":
            return FULL_DAY_START, FULL_DAY_END, True

        is_all_day = len(covered_creneaux) == 4

        return min_start, max_end, is_all_day

    def _resolve_option_label(self, label: str) -> list[str]:
        """
        Convert a row's option label into a list of option codes.
        "ANO/MHN" → ["ANO", "MHN"]
        "SP" → ["SP"]
        "ROB1" → ["ROB"]
        """
        if label in COMPOUND_OPTION_MAP:
            return COMPOUND_OPTION_MAP[label]
        if label in VALID_OPTIONS:
            return [label]
        # Unknown label — still return it but log a warning
        return [label]

    def _extract_event_type(self, text: str) -> tuple[str, str]:
        """
        Detect event type markers (CE, TP, BE, etc.) in the subject text.
        Returns (clean_subject, event_type).

        Examples:
            "Matériaux CE" → ("Matériaux", "CE")
            "TP Matériaux" → ("Matériaux", "TP")
            "Éléments finis BE noté" → ("Éléments finis", "BE")
            "Ingénierie Mécanique" → ("Ingénierie Mécanique", "")
        """
        event_type = ""
        subject = text

        # Check for CE/BE at end: "Subject CE", "Subject BE noté"
        for marker in ("CE", "BE"):
            pattern = rf"\b{marker}\b"
            if re.search(pattern, text):
                event_type = marker
                # Remove the marker and any trailing "noté"
                subject = re.sub(rf"\s*\b{marker}\b\s*(noté\s*)?", " ", text).strip()
                break

        # Check for TP/Amphi at start: "TP Subject"
        if not event_type:
            for marker in ("TP", "Amphi"):
                if text.startswith(f"{marker} "):
                    event_type = marker
                    subject = text[len(marker):].strip()
                    break
                # Also check for "Subject TP" pattern
                if text.endswith(f" {marker}"):
                    event_type = marker
                    subject = text[:-len(marker)].strip()
                    break

        return subject, event_type
