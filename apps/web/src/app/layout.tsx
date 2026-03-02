import type React from "react"
import type { Metadata } from "next"
import "./globals.css"

// Updated metadata for OpenScribe clinical documentation app
export const metadata: Metadata = {
  title: "OpenScribe",
  description: "AI-powered clinical documentation assistant",
  generator: "v0.app",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/favicon.ico",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`font-sans antialiased`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
