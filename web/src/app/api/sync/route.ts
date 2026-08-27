import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { syncToGoogleCalendar } from "@/lib/gcal-sync";
import type { SyncRequest } from "@/lib/types";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json(
      { error: "Conecte sua conta Google primeiro." },
      { status: 401 },
    );
  }

  try {
    const body = (await req.json()) as SyncRequest;

    if (!body.events?.length) {
      return NextResponse.json(
        { error: "Nenhum evento para sincronizar." },
        { status: 400 },
      );
    }

    if (!body.calendarName?.trim()) {
      return NextResponse.json(
        { error: "Nome do calendário obrigatório." },
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
    const message = err instanceof Error ? err.message : "Erro desconhecido";

    if (message.startsWith("BULK_DELETE:")) {
      const count = message.split(":")[1];
      return NextResponse.json(
        {
          error: "bulk_delete",
          message: `${count} eventos obsoletos seriam removidos.`,
          count: parseInt(count, 10),
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
