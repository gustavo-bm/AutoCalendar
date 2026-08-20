"""
Google Calendar synchronization module for AutoCalendar.

Handles all Google Calendar API interactions:
- OAuth2 authentication flow
- Creating/finding the dedicated calendar
- Inserting, updating, and (safely) deleting events
- Idempotency via deterministic event IDs
"""

import hashlib
import json
import os
from datetime import datetime, timedelta

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from config import (
    SCOPES, CREDENTIALS_FILE, TOKEN_FILE,
    CALENDAR_NAME_TEMPLATE, BULK_DELETE_THRESHOLD,
)
from ods_parser import ScheduleEvent
from event_filter import classify_event_title, build_event_description


def generate_event_id(event: ScheduleEvent) -> str:
    """
    Generate a deterministic, unique event ID based on event properties.
    Google Calendar event IDs must be lowercase alphanumeric + some chars,
    5-1024 characters long.

    Hash: MD5 of (date + start_time + subject + option)
    """
    raw = f"{event.date.isoformat()}|{event.start_time}|{event.subject}|{event.option}"
    hash_hex = hashlib.md5(raw.encode("utf-8")).hexdigest()
    # Google Calendar IDs must match: [a-v0-9]{5,1024}
    # Convert hex to base32-like (only a-v and 0-9)
    event_id = ""
    for ch in hash_hex:
        if ch.isdigit():
            event_id += ch
        else:
            # Map a-f → a-f (already valid)
            event_id += ch
    # Ensure minimum 5 chars (MD5 hex is 32 chars, so always fine)
    return f"autocalendar{event_id}"


# Google Calendar event colorId values (1–11).
GOOGLE_EVENT_COLOR_IDS = tuple(str(i) for i in range(1, 12))


def get_color_id_for_event_name(name: str) -> str:
    """
    Map an event name to one of the 11 default Google Calendar colorIds.
    Same name always gets the same color across syncs.
    """
    if not name:
        return "8"  # Graphite (default)

    hash_hex = hashlib.md5(name.strip().encode("utf-8")).hexdigest()
    color_index = int(hash_hex, 16) % len(GOOGLE_EVENT_COLOR_IDS)
    return GOOGLE_EVENT_COLOR_IDS[color_index]


def build_gcal_event_body(event: ScheduleEvent, timezone: str = "Europe/Paris") -> dict:
    """
    Build the Google Calendar API event resource body.
    """
    title = classify_event_title(event)
    description = build_event_description(event)
    color_id = get_color_id_for_event_name(title)

    if event.is_all_day:
        return {
            "summary": title,
            "description": description,
            "colorId": color_id,
            "start": {
                "date": event.date.isoformat(),
            },
            "end": {
                "date": (event.date + timedelta(days=1)).isoformat(),
            },
            "transparency": "transparent" if event.is_optional else "opaque",
        }
    else:
        start_dt = datetime.combine(
            event.date,
            datetime.strptime(event.start_time, "%H:%M").time()
        )
        end_dt = datetime.combine(
            event.date,
            datetime.strptime(event.end_time, "%H:%M").time()
        )

        return {
            "summary": title,
            "description": description,
            "colorId": color_id,
            "start": {
                "dateTime": start_dt.isoformat(),
                "timeZone": timezone,
            },
            "end": {
                "dateTime": end_dt.isoformat(),
                "timeZone": timezone,
            },
            "transparency": "transparent" if event.is_optional else "opaque",
        }


class GoogleCalendarSync:
    """
    Manages synchronization with Google Calendar.

    Safety features:
    - Never touches the primary calendar
    - Creates/uses a dedicated secondary calendar
    - Idempotent via deterministic event IDs
    - Bulk deletion protection
    """

    def __init__(self):
        self.service = None
        self.calendar_id = None

    def authenticate(self):
        """
        Authenticate with Google Calendar API using OAuth2.
        Saves/loads token for subsequent runs.
        """
        creds = None

        if os.path.exists(TOKEN_FILE):
            creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                print("🔄 Refreshing expired token...")
                creds.refresh(Request())
            else:
                cred_path = CREDENTIALS_FILE if os.path.exists(CREDENTIALS_FILE) else "client_secret.json"
                if not os.path.exists(cred_path):
                    print(f"❌ ERROR: '{CREDENTIALS_FILE}' or 'client_secret.json' not found!")
                    print("   Please download your OAuth credentials from Google Cloud Console.")
                    print("   See SETUP_GUIDE.md for instructions.")
                    raise FileNotFoundError(
                        f"Google OAuth credentials file '{CREDENTIALS_FILE}' or 'client_secret.json' not found."
                    )

                print("🔐 Opening browser for Google authentication...")
                flow = InstalledAppFlow.from_client_secrets_file(
                    cred_path, SCOPES
                )
                creds = flow.run_local_server(port=0)

            # Save token for next run
            with open(TOKEN_FILE, "w") as token:
                token.write(creds.to_json())
            print("✅ Authentication successful! Token saved.")

        self.service = build("calendar", "v3", credentials=creds)
        print("✅ Connected to Google Calendar API.")

    def get_or_create_calendar(self, option: str) -> str:
        """
        Find or create the dedicated secondary calendar.
        Returns the calendar ID.
        """
        calendar_name = CALENDAR_NAME_TEMPLATE.format(option=option)

        # List existing calendars
        calendar_list = self.service.calendarList().list().execute()
        for cal in calendar_list.get("items", []):
            if cal["summary"] == calendar_name:
                self.calendar_id = cal["id"]
                print(f"📅 Found existing calendar: '{calendar_name}'")
                return self.calendar_id

        # Create new calendar
        print(f"📅 Creating new calendar: '{calendar_name}'...")
        new_cal = self.service.calendars().insert(body={
            "summary": calendar_name,
            "timeZone": "Europe/Paris",
            "description": f"Emploi du temps ENSTA Bretagne FISE 2A - Option {option} (AutoCalendar)",
        }).execute()

        self.calendar_id = new_cal["id"]
        print(f"✅ Calendar created: '{calendar_name}' (ID: {self.calendar_id})")
        return self.calendar_id

    def sync_events(self, events: list[ScheduleEvent]) -> dict:
        """
        Synchronize events to Google Calendar.
        Returns a summary dict with counts.

        Idempotency: uses deterministic event IDs to update existing
        events instead of creating duplicates.
        """
        if not self.calendar_id:
            raise RuntimeError("Calendar not set. Call get_or_create_calendar() first.")

        stats = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}

        for i, event in enumerate(events):
            if event.is_vacation:
                stats["skipped"] += 1
                continue

            event_id = generate_event_id(event)
            body = build_gcal_event_body(event)

            try:
                # Try to get existing event
                try:
                    existing = self.service.events().get(
                        calendarId=self.calendar_id,
                        eventId=event_id
                    ).execute()

                    # Event exists — update it
                    self.service.events().update(
                        calendarId=self.calendar_id,
                        eventId=event_id,
                        body=body
                    ).execute()
                    stats["updated"] += 1

                except HttpError as e:
                    if e.resp.status == 404:
                        # Event doesn't exist — create it
                        body["id"] = event_id
                        self.service.events().insert(
                            calendarId=self.calendar_id,
                            body=body
                        ).execute()
                        stats["created"] += 1
                    else:
                        raise

            except HttpError as e:
                print(f"   ❌ Error syncing event '{event.subject}' on {event.date}: {e}")
                stats["errors"] += 1

            # Progress indicator
            if (i + 1) % 20 == 0:
                print(f"   📊 Progress: {i + 1}/{len(events)} events processed...")

        return stats

    def cleanup_stale_events(
        self, current_events: list[ScheduleEvent]
    ) -> int:
        """
        Remove events from the calendar that are no longer in the schedule.
        Implements bulk deletion protection.

        Returns the number of events deleted.
        """
        if not self.calendar_id:
            raise RuntimeError("Calendar not set.")

        # Get all current event IDs
        current_ids = set()
        for event in current_events:
            if not event.is_vacation:
                current_ids.add(generate_event_id(event))

        # List all events in the calendar
        existing_events = []
        page_token = None
        while True:
            result = self.service.events().list(
                calendarId=self.calendar_id,
                pageToken=page_token,
                maxResults=2500,
            ).execute()
            existing_events.extend(result.get("items", []))
            page_token = result.get("nextPageToken")
            if not page_token:
                break

        # Find stale events (in calendar but not in current schedule)
        stale_ids = []
        for existing in existing_events:
            eid = existing.get("id", "")
            if eid.startswith("autocalendar") and eid not in current_ids:
                stale_ids.append(eid)

        if not stale_ids:
            print("   ✅ No stale events to remove.")
            return 0

        # Bulk deletion protection
        if len(stale_ids) > BULK_DELETE_THRESHOLD:
            print(f"\n   ⚠️  ATTENTION: {len(stale_ids)} events would be deleted.")
            print(f"   This exceeds the safety threshold of {BULK_DELETE_THRESHOLD}.")
            confirm = input("   Type 'DELETE' to confirm mass deletion, or anything else to skip: ")
            if confirm.strip() != "DELETE":
                print("   ⏭️  Skipping deletion.")
                return 0

        deleted = 0
        for eid in stale_ids:
            try:
                self.service.events().delete(
                    calendarId=self.calendar_id,
                    eventId=eid
                ).execute()
                deleted += 1
            except HttpError as e:
                print(f"   ❌ Error deleting event {eid}: {e}")

        print(f"   🗑️  Deleted {deleted} stale events.")
        return deleted
