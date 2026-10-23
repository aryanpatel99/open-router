const encoder = new TextEncoder();

// Store connected SSE clients
const clients = new Set<ReadableStreamDefaultController>();

export function addClient(controller: ReadableStreamDefaultController) {
  clients.add(controller);

  // Send initial connection event
  const msg = `data: ${JSON.stringify({ type: "connected" })}\n\n`;
  controller.enqueue(encoder.encode(msg));
}

export function removeClient(controller: ReadableStreamDefaultController) {
  clients.delete(controller);
}

// Called by notify POST — broadcast to all SSE clients
export function broadcastUpdate() {
  const message = `data: ${JSON.stringify({ type: "update", timestamp: Date.now() })}\n\n`;
  const encoded = encoder.encode(message);
  for (const controller of clients) {
    try {
      controller.enqueue(encoded);
    } catch {
      clients.delete(controller);
    }
  }
}
