'use client'

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@/lib/auth-context'
import type { WalletSummary } from '@/lib/types'
import { deserializeWalletSummary, type WalletSummaryWire } from '@/lib/wallet/serialization'

export type WalletContextValue =
  | { status: 'idle'; wallet: null; error: null }
  | { status: 'loading'; wallet: null; error: null }
  | { status: 'loaded'; wallet: WalletSummary; error: null }
  | { status: 'error'; wallet: null; error: Error }

const idleValue: WalletContextValue = { status: 'idle', wallet: null, error: null }

const WalletContext = createContext<WalletContextValue>(idleValue)

interface WalletProviderProps {
  children: ReactNode
  /**
   * Test-only seam. When provided, the provider skips its internal fetch and
   * exposes the supplied value directly. Used by unit tests so the consumer
   * trees can be exercised without mocking the network.
   */
  __initialValue?: WalletContextValue
}

export function WalletProvider({ children, __initialValue }: WalletProviderProps) {
  const { authMode, user } = useAuth()
  const [fetchedValue, setFetchedValue] = useState<WalletContextValue>(idleValue)
  const lastFetchKey = useRef<string | null>(null)

  // Derived at render time: only fetch when in supabase mode with a real user
  // and no test injection. This avoids a setState in the effect for the
  // off-path cases (per react-hooks/set-state-in-effect).
  const shouldFetch = __initialValue === undefined && authMode === 'supabase' && user !== null
  const userId = user?.id ?? null

  useEffect(() => {
    if (!shouldFetch || !userId) {
      lastFetchKey.current = null
      return
    }

    if (lastFetchKey.current === userId) return
    lastFetchKey.current = userId

    let cancelled = false
    setFetchedValue({ status: 'loading', wallet: null, error: null })

    fetch('/api/wallet?limit=5', {
      method: 'GET',
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)

        if (!response.ok) {
          const message =
            payload && typeof payload.error === 'string'
              ? payload.error
              : 'No se pudo cargar la wallet.'
          throw new Error(message)
        }

        return payload as { data: WalletSummaryWire }
      })
      .then((payload) => {
        if (cancelled) return
        const wallet = deserializeWalletSummary(payload.data)
        setFetchedValue({ status: 'loaded', wallet, error: null })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const err = error instanceof Error ? error : new Error(String(error))
        setFetchedValue({ status: 'error', wallet: null, error: err })
      })

    return () => {
      cancelled = true
    }
  }, [shouldFetch, userId])

  const value: WalletContextValue =
    __initialValue !== undefined
      ? __initialValue
      : !shouldFetch
        ? idleValue
        : fetchedValue

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

/**
 * Returns the wallet state from the nearest WalletProvider. Outside a provider
 * this returns an idle value so consumers can render safely without erroring.
 */
export function useWalletContext(): WalletContextValue {
  return useContext(WalletContext)
}
