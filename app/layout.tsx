import React from "react"
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/lib/auth-context'
import type { User } from '@/lib/types'
import { mapProfileToClientUser, type AuthMode } from '@/lib/auth-user'
import { hasSupabasePublicEnv, isSupabaseAuthEnabled } from '@/lib/env'
import { getCurrentPrincipal } from '@/lib/server/auth/session'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'NoonApp - Sales & Delivery Platform',
  description: 'Plataforma integral para gestión de ventas, proyectos y equipos',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#080717',
  width: 'device-width',
  initialScale: 1,
}

async function getInitialAuthState(): Promise<{
  authMode: AuthMode
  initialUser: User | null
}> {
  const authMode: AuthMode =
    isSupabaseAuthEnabled() && hasSupabasePublicEnv() ? 'supabase' : 'mock'

  if (authMode !== 'supabase') {
    return {
      authMode,
      initialUser: null,
    }
  }

  // Public routes should render anonymously when no Supabase session exists.
  const principal = await getCurrentPrincipal()

  return {
    authMode,
    initialUser: principal ? mapProfileToClientUser(principal.profile) : null,
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const { authMode, initialUser } = await getInitialAuthState()

  return (
    <html lang="es">
      <body className={`${inter.variable} font-sans antialiased`}>
        <AuthProvider authMode={authMode} initialUser={initialUser}>
          {children}
          <Toaster position="top-right" richColors />
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  )
}
