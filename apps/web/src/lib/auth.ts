import NextAuth, { type NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import PostgresAdapter from "@auth/pg-adapter"
import { getDbPool } from "./db"
import { isHipaaHostedMode } from "./hipaa-config"

const baseAuthOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      allowDangerousEmailAccountLinking: false,
    }),
  ],
  secret: process.env.AUTH_SECRET || "local-dev-auth-secret",
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
    updateAge: 60 * 60,
  },
  callbacks: {
    async session({ session, user, token }) {
      const userId = user?.id || (typeof token?.sub === "string" ? token.sub : undefined)
      if (session.user && userId) {
        ;(session.user as { id?: string }).id = userId
      }
      return session
    },
  },
}

export const authOptions: NextAuthOptions = isHipaaHostedMode()
  ? {
      ...baseAuthOptions,
      adapter: PostgresAdapter(getDbPool()),
      session: {
        strategy: "database",
        maxAge: 8 * 60 * 60,
        updateAge: 60 * 60,
      },
      cookies: {
        sessionToken: {
          name: process.env.NODE_ENV === "production" ? "__Secure-next-auth.session-token" : "next-auth.session-token",
          options: {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
            secure: process.env.NODE_ENV === "production",
          },
        },
      },
    }
  : baseAuthOptions

export default NextAuth(authOptions)
