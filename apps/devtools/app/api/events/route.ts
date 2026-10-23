import { NextResponse } from "next/server";
import { addClient, removeClient } from "@/lib/events";

export async function GET() {
  let client: ReadableStreamDefaultController;
  const stream = new ReadableStream({
    start(controller) {
      client = controller;
      addClient(controller);
    },
    cancel() {
      removeClient(client);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
