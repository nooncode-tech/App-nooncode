import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type { AuthenticatedPrincipal } from '@/lib/server/profiles/types'
import type { WalletSummaryWire } from '@/lib/wallet/serialization'
import {
  mapWalletEntryRowToWire,
  mapWalletToWire,
  mapMonetaryLedgerEntryToWire,
} from '@/lib/server/wallet/mappers'
import {
  ensureCurrentUserWallet,
  getPrototypeCreditSettings,
  listWalletEntries,
  ensureMonetaryWallet,
  listMonetaryLedgerEntries,
} from '@/lib/server/wallet/repository'

type DatabaseClient = SupabaseClient<Database>

export async function getVisibleWallet(
  client: DatabaseClient,
  principal: AuthenticatedPrincipal,
  limit: number
): Promise<WalletSummaryWire> {
  const [wallet, entries, settings, monetaryWallet, monetaryLedgerRows] = await Promise.all([
    ensureCurrentUserWallet(client),
    listWalletEntries(client, principal.profile.id, limit),
    getPrototypeCreditSettings(client),
    ensureMonetaryWallet(client),
    listMonetaryLedgerEntries(client, principal.profile.id, limit),
  ])

  return mapWalletToWire(
    wallet,
    settings?.request_cost ?? null,
    entries.map(mapWalletEntryRowToWire),
    monetaryWallet,
    monetaryLedgerRows.map(mapMonetaryLedgerEntryToWire)
  )
}
