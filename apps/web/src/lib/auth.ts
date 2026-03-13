import NextAuth, { type NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import PostgresAdapter from "@auth/pg-adapter"
import { getDbPool } from "./db"

export const authOptions: NextAuthOptions = {
  adapter: PostgresAdapter(getDbPool()),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      allowDangerousEmailAccountLinking: false,
    }),
  ],
  secret: process.env.AUTH_SECRET,
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
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        ;(session.user as { id?: string }).id = user.id
      }
      return session
    },
  },
}

export default NextAuth(authOptions)
