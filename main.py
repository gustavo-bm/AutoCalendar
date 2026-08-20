#!/usr/bin/env python3
"""
AutoCalendar — ENSTA Bretagne FISE 2A Schedule Synchronizer

Main entry point. Reads the ODS schedule file, filters events
for the selected option/track, generates a preview, and optionally
syncs to Google Calendar.

Usage:
    python main.py                          # Interactive mode
    python main.py --option ROB             # Specify option directly
    python main.py --option ROB --dry-run   # Preview only, no sync
    python main.py --option ROB --sync      # Skip preview confirmation
"""

import argparse
import csv
import json
import os
import sys
from datetime import date

from config import VALID_OPTIONS
from ods_parser import ODSParser
from event_filter import (
    filter_schedule_for_option,
    classify_event_title,
    build_event_description,
)

# ─────────────────────────────────────────────────────────
# Default paths
# ─────────────────────────────────────────────────────────
DEFAULT_ODS_FILE = "2026-2027 - Planification des cours Brest.ods"
PREVIEW_CSV = "preview_schedule.csv"
PREVIEW_JSON = "preview_events.json"
WARNINGS_FILE = "warnings.json"


def print_banner():
    """Display a nice startup banner."""
    print("""
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   📅  AutoCalendar — ENSTA Bretagne FISE 2A                  ║
║   ─────────────────────────────────────────                   ║
║   Synchroniseur d'emploi du temps → Google Calendar           ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    """)


def select_option_interactive() -> str:
    """Prompt the user to select their option/track."""
    print("🎓 Sélectionnez votre option / Select your track:")
    print()
    for i, opt in enumerate(VALID_OPTIONS, 1):
        print(f"   {i}. {opt}")
    print()

    while True:
        choice = input("   Entrez le numéro ou la sigla (ex: 3 ou ROB): ").strip().upper()

        # Try as number
        try:
            idx = int(choice) - 1
            if 0 <= idx < len(VALID_OPTIONS):
                return VALID_OPTIONS[idx]
        except ValueError:
            pass

        # Try as abbreviation
        if choice in VALID_OPTIONS:
            return choice

        print(f"   ❌ Choix invalide. Options valides: {VALID_OPTIONS}")


def parse_schedule(ods_file: str, selected_option: str) -> tuple:
    """
    Parse the ODS file and filter events for the selected option.
    Returns (filtered_events, parser_warnings).
    """
    print(f"\n📂 Lecture du fichier: {ods_file}")
    parser = ODSParser(ods_file)

    print("⏳ Parsing de la planification...")
    all_events = parser.parse()
    print(f"   ✅ {len(all_events)} événements bruts extraits.")

    print(f"\n🔍 Filtrage pour l'option: {selected_option}")
    filtered = filter_schedule_for_option(parser, all_events, selected_option)
    print(f"   ✅ {len(filtered)} événements après filtrage.")

    return filtered, parser.warnings


def generate_preview(events: list, selected_option: str) -> None:
    """
    Generate preview files (CSV and JSON) and display summary.
    """
    # ── CSV Preview ───────────────────────────────────────
    with open(PREVIEW_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "Date", "Jour", "Début", "Fin", "Matière",
            "Type", "Option", "All-Day", "Vacation"
        ])
        for event in events:
            writer.writerow([
                event.date.isoformat(),
                event.date.strftime("%A"),
                event.start_time,
                event.end_time,
                classify_event_title(event),
                event.event_type,
                event.option,
                event.is_all_day,
                event.is_vacation,
            ])

    # ── JSON Preview ──────────────────────────────────────
    json_events = []
    for event in events:
        json_events.append({
            "date": event.date.isoformat(),
            "start_time": event.start_time,
            "end_time": event.end_time,
            "title": classify_event_title(event),
            "subject": event.subject,
            "event_type": event.event_type,
            "option": event.option,
            "is_all_day": event.is_all_day,
            "is_vacation": event.is_vacation,
            "is_optional": event.is_optional,
            "week_number": event.week_number,
        })

    with open(PREVIEW_JSON, "w", encoding="utf-8") as f:
        json.dump(json_events, f, ensure_ascii=False, indent=2)

    # ── Terminal Summary ──────────────────────────────────
    non_vacation = [e for e in events if not e.is_vacation]
    vacations = [e for e in events if e.is_vacation]
    dates_list = [e.date for e in non_vacation]

    print(f"\n{'='*60}")
    print(f"   📊 RÉSUMÉ DE LA PRÉVIA / PREVIEW SUMMARY")
    print(f"{'='*60}")
    print(f"   Option sélectionnée : {selected_option}")
    print(f"   Total d'événements  : {len(events)}")
    print(f"   Cours/activités     : {len(non_vacation)}")
    print(f"   Vacances/fériés     : {len(vacations)}")

    if dates_list:
        print(f"   Première date       : {min(dates_list).isoformat()}")
        print(f"   Dernière date       : {max(dates_list).isoformat()}")

    # Show first 5 events
    print(f"\n   📋 Premiers 5 événements:")
    print(f"   {'─'*50}")
    for event in non_vacation[:5]:
        title = classify_event_title(event)
        print(f"   {event.date.isoformat()} | {event.start_time}-{event.end_time} | {title}")

    if len(non_vacation) > 5:
        print(f"   ... et {len(non_vacation) - 5} autres événements")

    print(f"\n   📄 Fichiers de prévia générés:")
    print(f"      → {PREVIEW_CSV}")
    print(f"      → {PREVIEW_JSON}")
    print(f"{'='*60}")


def save_warnings(warnings: list) -> None:
    """Save parser warnings to a JSON file for user review."""
    if not warnings:
        return

    warning_data = []
    for w in warnings:
        warning_data.append({
            "row": w.row,
            "col": w.col,
            "message": w.message,
            "raw_text": w.raw_text,
        })

    with open(WARNINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(warning_data, f, ensure_ascii=False, indent=2)

    print(f"\n⚠️  {len(warnings)} avertissements enregistrés dans '{WARNINGS_FILE}'")
    for w in warnings[:3]:
        print(f"   Row {w.row}, Col {w.col}: {w.message}")
    if len(warnings) > 3:
        print(f"   ... et {len(warnings) - 3} autres avertissements")


def sync_to_google_calendar(events: list, selected_option: str) -> None:
    """Perform the actual Google Calendar synchronization."""
    from gcal_sync import GoogleCalendarSync

    sync = GoogleCalendarSync()

    print("\n🔐 Authentification Google Calendar...")
    sync.authenticate()

    print(f"\n📅 Configuration du calendrier dédié...")
    sync.get_or_create_calendar(selected_option)

    print(f"\n🔄 Synchronisation de {len([e for e in events if not e.is_vacation])} événements...")
    stats = sync.sync_events(events)

    print(f"\n{'='*60}")
    print(f"   ✅ SYNCHRONISATION TERMINÉE")
    print(f"{'='*60}")
    print(f"   Créés    : {stats['created']}")
    print(f"   Mis à jour : {stats['updated']}")
    print(f"   Ignorés  : {stats['skipped']}")
    print(f"   Erreurs  : {stats['errors']}")
    print(f"{'='*60}")

    # Cleanup stale events
    print(f"\n🧹 Vérification des événements obsolètes...")
    deleted = sync.cleanup_stale_events(events)
    if deleted:
        print(f"   🗑️  {deleted} événements obsolètes supprimés.")


def main():
    """Main entry point."""
    print_banner()

    # ── Argument parsing ──────────────────────────────────
    arg_parser = argparse.ArgumentParser(
        description="AutoCalendar — Sync ENSTA Bretagne FISE 2A schedule to Google Calendar"
    )
    arg_parser.add_argument(
        "--option", "-o",
        choices=VALID_OPTIONS,
        help="Option/track abbreviation (e.g., ROB, ANO, SP)"
    )
    arg_parser.add_argument(
        "--file", "-f",
        default=DEFAULT_ODS_FILE,
        help=f"Path to ODS schedule file (default: {DEFAULT_ODS_FILE})"
    )
    arg_parser.add_argument(
        "--dry-run", "-d",
        action="store_true",
        help="Generate preview only, do not sync to Google Calendar"
    )
    arg_parser.add_argument(
        "--sync", "-s",
        action="store_true",
        help="Sync to Google Calendar without interactive confirmation"
    )
    arg_parser.add_argument(
        "--weeks", "-w",
        type=int,
        default=0,
        help="Limit synchronization to the first N weeks (0 = all weeks). Ideal for testing."
    )

    args = arg_parser.parse_args()

    # ── Validate input file ───────────────────────────────
    if not os.path.exists(args.file):
        print(f"❌ Fichier non trouvé: {args.file}")
        sys.exit(1)

    # ── Select option ─────────────────────────────────────
    if args.option:
        selected_option = args.option
        print(f"🎓 Option sélectionnée: {selected_option}")
    else:
        selected_option = select_option_interactive()

    print(f"\n✅ Option choisie: {selected_option}")

    # ── Parse schedule ────────────────────────────────────
    events, warnings = parse_schedule(args.file, selected_option)

    # ── Limit weeks ───────────────────────────────────────
    if args.weeks > 0 and events:
        from datetime import timedelta
        min_date = min(e.date for e in events)
        first_monday = min_date - timedelta(days=min_date.weekday())
        cutoff_date = first_monday + timedelta(days=7 * args.weeks)
        
        events = [e for e in events if e.date < cutoff_date]
        print(f"   ⏱️ Limitation activée: {args.weeks} semaine(s) (événements jusqu'au {cutoff_date})")
        print(f"   ✅ {len(events)} événements conservés après limitation.")

    # ── Save warnings ─────────────────────────────────────
    save_warnings(warnings)

    # ── Generate preview ──────────────────────────────────
    generate_preview(events, selected_option)

    # ── Dry run mode ──────────────────────────────────────
    if args.dry_run:
        print("\n🏁 Mode dry-run: pas de synchronisation.")
        print("   Vérifiez les fichiers de prévia et relancez sans --dry-run pour synchroniser.")
        sys.exit(0)

    # ── Confirmation ──────────────────────────────────────
    if not args.sync:
        print("\n❓ Voulez-vous synchroniser avec Google Calendar? (Y/N)")
        confirm = input("   → ").strip().upper()
        if confirm != "Y":
            print("\n⏹️  Synchronisation annulée.")
            sys.exit(0)

    # ── Sync ──────────────────────────────────────────────
    sync_to_google_calendar(events, selected_option)

    print("\n🎉 Terminé! Vérifiez votre Google Calendar.")


if __name__ == "__main__":
    main()
