import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type { AuthenticatedPrincipal } from '@/lib/server/profiles/types'
import type { WalletAccountRow, WalletRow } from '@/lib/server/wallet/types'
import type { WalletSummaryWire } from '@/lib/wallet/serialization'
import { ApiError } from '@/lib/server/api/errors'
import {
  mapWalletEntryRowToWire,
  mapWalletToWire,
  mapMonetaryLedgerEntryToWire,
} from '@/lib/server/wallet/mappers'
import {
  ensureUserWalletForProfile,
  getPrototypeCreditSettings,
  listWalletEntries,
  ensureMonetaryWalletForProfile,
  listMonetaryLedgerEntries,
} from '@/lib/server/wallet/repository'

type DatabaseClient = SupabaseClient<Database>

export interface WalletDataClients {
  userClient: DatabaseClient
  adminClient: DatabaseClient
}

function normalizeWalletEnsureError(error: unknown): never {
  const message = error instanceof Error ? error.message : 'Unexpected wallet ensure failure.'

  if (message.includes('PROFILE_NOT_FOUND')) {
    throw new ApiError('PROFILE_NOT_FOUND', 'An active user profile is required before loading this wallet.', 403)
  }

  throw new Error('Wallet could not be initialized for the current profile.')
}

export async function getVisibleWallet(
  clients: WalletDataClients,
  principal: AuthenticatedPrincipal,
  limit: number
): Promise<WalletSummaryWire> {
  const { userClient, adminClient } = clients
  let wallet: WalletRow
  let monetaryWallet: WalletAccountRow | null

  try {
    wallet = await ensureUserWalletForProfile(adminClient, principal.profile.id)
    monetaryWallet = await ensureMonetaryWalletForProfile(adminClient, principal.profile.id)
  } catch (error) {
    normalizeWalletEnsureError(error)
  }

  const [entries, settings, monetaryLedgerRows] = await Promise.all([
    listWalletEntries(userClient, principal.profile.id, limit),
    getPrototypeCreditSettings(userClient),
    listMonetaryLedgerEntries(userClient, principal.profile.id, limit),
  ])

  return mapWalletToWire(
    wallet,
    settings?.request_cost ?? null,
    entries.map(mapWalletEntryRowToWire),
    monetaryWallet,
    monetaryLedgerRows.map(mapMonetaryLedgerEntryToWire)
  )
}
