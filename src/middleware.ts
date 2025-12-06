import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])

function shouldSkipRedirect(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname)
}

export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next()
  }

  const hostHeader = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? ""
  const hostname = hostHeader.split(":")[0]?.toLowerCase() ?? ""
  if (shouldSkipRedirect(hostname)) {
    return NextResponse.next()
  }

  const protocolHeader = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol
  const protocol = protocolHeader.split(",")[0]?.replace(":", "")

  if (protocol !== "https") {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.protocol = "https"
    redirectUrl.port = ""
    return NextResponse.redirect(redirectUrl, 308)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/:path*"],
}
