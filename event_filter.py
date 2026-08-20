"""
Event filtering module for AutoCalendar.

Applies the option-based filtering logic to select which events
belong to a specific student's schedule, handling:
- Direct option matches
- Compound option groups (ANO/MHN)
- Tronc commun / shared events (spanning all option rows)
- Vacation and optional event classification
"""

from datetime import date
from ods_parser import ScheduleEvent, ODSParser, OPTIONS_PER_WEEK_BLOCK
from config import VALID_OPTIONS, COMPOUND_OPTION_MAP, VACATION_KEYWORDS


def filter_schedule_for_option(
    parser: ODSParser,
    events: list[ScheduleEvent],
    selected_option: str,
) -> list[ScheduleEvent]:
    """
    Master filter: returns only the events relevant to the selected option.

    Strategy:
    1. Collect events directly tagged for the selected option.
    2. Collect shared/tronc commun events (cells with rowspan spanning all options).
    3. Deduplicate by (date, start_time, subject).
    4. Exclude vacations (keep them flagged but don't remove — useful for calendar).
    """
    if selected_option not in VALID_OPTIONS:
        raise ValueError(
            f"Invalid option '{selected_option}'. "
            f"Valid options: {VALID_OPTIONS}"
        )

    grid = parser._grid
    direct_events = []
    shared_events = []
    seen = set()

    for event in events:
        dedup_key = (event.date, event.start_time, event.end_time, event.subject)

        # ── Direct match ──────────────────────────────────
        if event.option == selected_option:
            if dedup_key not in seen:
                seen.add(dedup_key)
                direct_events.append(event)
            continue

        # ── Compound group match (ANO/MHN) ────────────────
        for compound, members in COMPOUND_OPTION_MAP.items():
            if selected_option in members and event.option in members:
                if dedup_key not in seen:
                    seen.add(dedup_key)
                    direct_events.append(event)
                break

    # ── Shared events (tronc commun) ──────────────────────
    # These come from the first option row (ANO/MHN) and have
    # rowspan >= OPTIONS_PER_WEEK_BLOCK, meaning they span all options
    for event in events:
        dedup_key = (event.date, event.start_time, event.end_time, event.subject)
        if dedup_key in seen:
            continue

        origin_row = event.source_row
        origin_col = event.source_col

        if origin_row >= len(grid) or origin_col >= len(grid[origin_row]):
            continue

        cell = grid[origin_row][origin_col]
        rowspan = cell.get("rowspan", 1)

        # A cell spanning all option rows is shared/common
        if rowspan >= OPTIONS_PER_WEEK_BLOCK:
            seen.add(dedup_key)
            # Create a copy tagged as shared
            shared_event = ScheduleEvent(
                date=event.date,
                start_time=event.start_time,
                end_time=event.end_time,
                subject=event.subject,
                event_type=event.event_type,
                option="TRONC_COMMUN",
                is_all_day=event.is_all_day,
                is_vacation=event.is_vacation,
                is_optional=event.is_optional,
                source_row=event.source_row,
                source_col=event.source_col,
                week_number=event.week_number,
            )
            shared_events.append(shared_event)

    # ── Also check for "Semestre" label column events ─────
    # Column 1 sometimes has "Semestre 3" with rowspan=8, which is
    # informational, not an actual class. Skip it.

    result = direct_events + shared_events

    # Sort by date, then start time
    result.sort(key=lambda e: (e.date, e.start_time))

    return result


def classify_event_title(event: ScheduleEvent) -> str:
    """
    Build the Google Calendar event title from the parsed event.

    Format: "Subject [TYPE]" if there's an event type, else just "Subject".
    Examples:
        - "Matériaux [CE]"
        - "Éléments finis [BE]"
        - "TP Matériaux"  (TP stays as prefix for clarity)
        - "Ingénierie Mécanique"
    """
    title = event.subject

    if event.event_type:
        if event.event_type in ("TP", "Amphi"):
            # If it's already at the start, don't duplicate
            if not title.startswith(event.event_type):
                title = f"{event.event_type} {title}"
        else:
            # If it already ends with [TYPE] or TYPE, don't duplicate
            if not title.endswith(f"[{event.event_type}]") and not title.endswith(event.event_type):
                title = f"{title} [{event.event_type}]"

    if event.is_vacation:
        title = f"🏖️ {title}"

    return title


def build_event_description(event: ScheduleEvent) -> str:
    """Build a descriptive body for the calendar event."""
    lines = []

    if event.event_type:
        from config import EVENT_TYPE_MARKERS
        type_desc = EVENT_TYPE_MARKERS.get(event.event_type, event.event_type)
        lines.append(f"📋 Type: {type_desc}")

    if event.option != "TRONC_COMMUN":
        lines.append(f"🎯 Option: {event.option}")
    else:
        lines.append("🎯 Tronc Commun (toutes options)")

    lines.append(f"📅 Semaine {event.week_number}")
    lines.append(f"⏰ {event.start_time} - {event.end_time}")

    if event.is_optional:
        lines.append("ℹ️ Travail personnel / Autonomie")

    lines.append("")
    lines.append("— Généré par AutoCalendar")

    return "\n".join(lines)
