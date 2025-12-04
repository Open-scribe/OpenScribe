import type { NextRequest } from "next/server"
import { transcriptionSessionStore } from "@/features/transcription"

function formatSseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ sessionId: string }> | { sessionId: string } },
) {
  const resolvedParams = "then" in context.params ? await context.params : context.params
  const { sessionId } = resolvedParams
  let cleanup: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      const sendEvent = (event: { event: string; data: Record<string, unknown> }) => {
        controller.enqueue(formatSseEvent(event.event, event.data))
      }

      const unsubscribe = transcriptionSessionStore.subscribe(sessionId, sendEvent)
      const keepAlive = setInterval(() => {
        controller.enqueue(formatSseEvent("keepalive", { session_id: sessionId, ts: Date.now() }))
      }, 15000)

      const abortHandler = () => cleanup?.()
      req.signal.addEventListener("abort", abortHandler)

      cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(keepAlive)
        unsubscribe()
        req.signal.removeEventListener("abort", abortHandler)
        try {
          controller.close()
        } catch {
          // ignore
        }
      }

      controller.enqueue(formatSseEvent("session", { session_id: sessionId }))
    },
    cancel() {
      cleanup?.()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
