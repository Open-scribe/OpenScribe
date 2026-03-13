import type { NextRequest } from "next/server"
import { transcriptionSessionStore } from "@transcript-assembly"
import { requireAuthenticatedUser, requireAcceptedTerms } from "@/lib/auth-guard"

export const runtime = "nodejs"

function formatSseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ sessionId: string }> | { sessionId: string } },
) {
  const auth = await requireAuthenticatedUser()
  if (!auth.ok) return auth.response
  const terms = await requireAcceptedTerms(auth.userId, req)
  if (!terms.ok) return terms.response

  const resolvedParams = "then" in context.params ? await context.params : context.params
  const { sessionId } = resolvedParams
  let cleanup: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      const sendEvent = (event: { event: string; data: Record<string, unknown> }) => {
        controller.enqueue(formatSseEvent(event.event, event.data))
      }

      let unsubscribe: (() => void) | null = null
      try {
        unsubscribe = transcriptionSessionStore.subscribe(sessionId, sendEvent, auth.userId)
      } catch {
        controller.enqueue(formatSseEvent("error", { code: "forbidden", message: "Session access denied" }))
        controller.close()
        return
      }
      const keepAlive = setInterval(() => {
        controller.enqueue(formatSseEvent("keepalive", { session_id: sessionId, ts: Date.now() }))
      }, 15000)

      const abortHandler = () => cleanup?.()
      req.signal.addEventListener("abort", abortHandler)

      cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(keepAlive)
        unsubscribe?.()
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
