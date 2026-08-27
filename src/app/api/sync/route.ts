import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { syncToGoogleCalendar } from "@/lib/gcal-sync";
import type { SyncRequest } from "@/lib/types";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json(
      { error: "Connectez d’abord votre compte Google." },
      { status: 401 },
    );
  }

  try {
    const body = (await req.json()) as SyncRequest;

    if (!body.events?.length) {
      return NextResponse.json(
        { error: "Aucun cours à synchroniser." },
        { status: 400 },
      );
    }

    if (!body.calendarName?.trim()) {
      return NextResponse.json(
        { error: "Indiquez un nom de calendrier." },
        { status: 400 },
      );
    }

    const stats = await syncToGoogleCalendar(
      session.accessToken,
      body.calendarName.trim(),
      body.events,
      body.confirmBulkDelete ?? false,
    );

    return NextResponse.json({ stats });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";

    if (message.startsWith("BULK_DELETE:")) {
      const count = message.split(":")[1];
      return NextResponse.json(
        {
          error: "bulk_delete",
          message: `${count} anciens cours seraient supprimés.`,
          count: parseInt(count, 10),
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
