import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { syncToGoogleCalendar } from "@/lib/gcal-sync";
import type { SyncRequest } from "@/lib/types";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json(
      { error: "Connectez d'abord votre compte Google.", code: "NO_TOKEN" },
      { status: 401 },
    );
  }

  // Check if the token refresh failed (flagged by auth.ts)
  const sessionError = (session as unknown as Record<string, unknown>).error;
  if (sessionError) {
    return NextResponse.json(
      {
        error: "Votre session a expiré. Veuillez vous reconnecter.",
        code: "SESSION_EXPIRED",
      },
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

    // Detect Google API auth errors
    const code = (err as { code?: number }).code;
    if (code === 401 || code === 403) {
      return NextResponse.json(
        {
          error: "Accès refusé par Google. Reconnectez-vous et réessayez.",
          code: "GOOGLE_AUTH_ERROR",
        },
        { status: 401 },
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

