'use client'

import { useEffect } from 'react'

interface GlobalErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

// global-error.tsx replaces the entire root HTML when the root layout itself
// throws (e.g. getCurrentPrincipal() failing because Supabase is unreachable).
// Tailwind / globals.css may not be loaded at this point, so styles are inline
// using the brand tokens documented in app/globals.css:
//   --primary: #1200c5   (Noon brand blue)
//   --background: oklch(0.985 0.002 275) ≈ #FBFBFB (near-white)
//   --foreground: oklch(0.13 0.03 275)   ≈ #18171F (near-black)
//   --muted-foreground ≈ #6F6E80
const NOON_PRIMARY = '#1200c5'
const NOON_BACKGROUND = '#FBFBFB'
const NOON_FOREGROUND = '#18171F'
const NOON_MUTED_FOREGROUND = '#6F6E80'
const NOON_BORDER_SUBTLE = '#E6E5EC'

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error('NoonApp global-error boundary captured:', error)
  }, [error])

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: NOON_BACKGROUND,
          color: NOON_FOREGROUND,
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          padding: '1rem',
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        <main
          style={{
            maxWidth: '28rem',
            width: '100%',
            textAlign: 'center',
          }}
        >
          <p
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: NOON_PRIMARY,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              margin: 0,
              marginBottom: '0.75rem',
            }}
          >
            NoonApp
          </p>
          <h1
            style={{
              fontSize: '1.75rem',
              fontWeight: 600,
              lineHeight: 1.2,
              margin: 0,
              marginBottom: '0.75rem',
            }}
          >
            La aplicación no pudo cargarse
          </h1>
          <p
            style={{
              color: NOON_MUTED_FOREGROUND,
              fontSize: '0.95rem',
              lineHeight: 1.5,
              margin: 0,
              marginBottom: error.digest ? '0.75rem' : '1.5rem',
            }}
          >
            Ocurrió un error inesperado al iniciar NoonApp. Reintentá; si el problema persiste, contactá al equipo.
          </p>
          {error.digest ? (
            <p
              style={{
                fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                fontSize: '0.75rem',
                color: NOON_MUTED_FOREGROUND,
                margin: 0,
                marginBottom: '1.5rem',
                padding: '0.375rem 0.75rem',
                border: `1px solid ${NOON_BORDER_SUBTLE}`,
                borderRadius: '0.375rem',
                display: 'inline-block',
              }}
            >
              Ref: {error.digest}
            </p>
          ) : null}
          <div>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                backgroundColor: NOON_PRIMARY,
                color: '#FFFFFF',
                border: 'none',
                padding: '0.625rem 1.5rem',
                borderRadius: '0.375rem',
                fontWeight: 500,
                fontSize: '0.95rem',
                cursor: 'pointer',
              }}
            >
              Reintentar
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
