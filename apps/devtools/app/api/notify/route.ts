import { NextResponse } from "next/server";
import { broadcastUpdate } from "@/lib/events";

export async function POST() {
  broadcastUpdate();
  return NextResponse.json({ ok: true });
}
