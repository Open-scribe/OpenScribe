/**
 * Pure request handler for POST /api/integrations/openemr/push
 *
 * Extracted from the Next.js route so it can be tested without importing
 * next/server (which cannot be compiled by the NodeNext test runner).
 *
 * Trust boundaries enforced here:
 *  ① Auth identity check  — rejects unauthenticated callers with 401
 *  ② Input validation     — rejects missing patientId/noteMarkdown with 400
 *  ③ Identity binding     — all 4 required fields forwarded to pushFn unchanged
 *
 * The route (route.ts) is a thin wrapper that calls this function.
 */

import type { PushParams, PushResult } from "./openemr-client.js"

export interface AuthContext {
  isAuthenticated: boolean
}

export type PushFn = (params: PushParams) => Promise<PushResult>

export interface HandlerResult {
  status: number
  json: unknown
}

/**
 * Handle a push request.
 *
 * @param auth    Authentication context (from requireAuthenticatedUser)
 * @param body    Parsed request body (unknown — validated inside)
 * @param pushFn  Function that performs the actual OpenEMR push (injectable for testing)
 */
export async function handlePushRequest(
  auth: AuthContext,
  body: unknown,
  pushFn: PushFn
): Promise<HandlerResult> {
  // Boundary ①: reject unauthenticated requests
  if (!auth.isAuthenticated) {
    return { status: 401, json: { success: false, error: "Unauthorized" } }
  }

  // Boundary ②: validate required fields
  if (!body || typeof body !== "object") {
    return { status: 400, json: { success: false, error: "Request body is required" } }
  }

  const b = body as Record<string, unknown>

  if (!b.patientId || typeof b.patientId !== "string") {
    return { status: 400, json: { success: false, error: "patientId is required" } }
  }

  if (!b.noteMarkdown || typeof b.noteMarkdown !== "string") {
    return { status: 400, json: { success: false, error: "noteMarkdown is required" } }
  }

  // Boundary ③: forward fields verbatim to pushFn
  const params: PushParams = {
    patientId: b.patientId,
    noteMarkdown: b.noteMarkdown,
    patientName: typeof b.patientName === "string" ? b.patientName : "",
    visitReason: typeof b.visitReason === "string" ? b.visitReason : "",
    encounterId: typeof b.encounterId === "string" ? b.encounterId : "",
  }

  const result = await pushFn(params)

  if (result.success) {
    return { status: 200, json: { success: true, id: result.id } }
  } else {
    return { status: 500, json: { success: false, error: result.error } }
  }
}
