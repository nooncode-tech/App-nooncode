import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPrototypeShareUrl } from '@/lib/server/prototypes/share-url'
import { mapPrototypeWorkspaceListItemRowToWire } from '@/lib/server/prototypes/mappers'
import type { PrototypeWorkspaceRowWithRelations } from '@/lib/server/prototypes/types'

// Unit coverage for the client-facing prototipo share URL.
// Covers the helper itself + the mapper's gating rule (ready/delivery_active
// + non-superseded). Stays in scope for the slice that exposed `shareUrl` on
// `/api/prototypes` and the "Copiar link" button on `/dashboard/prototypes`.

// `share_token` is NOT NULL in DB (migration 0060), so the generated
// `PrototypeWorkspaceRowWithRelations` types it as `string`. Tests want to
// exercise the null-token defensive branch in the mapper anyway, so we omit
// the column from Partial and redeclare it as nullable here.
function workspaceRow(
  overrides: Partial<
    Omit<PrototypeWorkspaceRowWithRelations, 'share_token' | 'share_token_superseded_at'>
  > & {
    share_token?: string | null
    share_token_superseded_at?: string | null
  } = {},
): PrototypeWorkspaceRowWithRelations {
  return {
    id: 'wsp-1',
    lead_id: 'lead-1',
    project_id: null,
    requested_by_profile_id: 'profile-1',
    current_stage: 'sales',
    status: 'ready',
    last_operation_id: null,
    generation_prompt: null,
    generated_content: null,
    generated_at: '2026-05-27T10:00:00.000Z',
    created_at: '2026-05-27T09:00:00.000Z',
    updated_at: '2026-05-27T10:00:00.000Z',
    demo_url: 'https://demo.vusercontent.net/x',
    chat_url: 'https://v0.app/chat/x',
    share_token: 'token-abc-123',
    share_token_superseded_at: null,
    lead: { id: 'lead-1', name: 'Acme' },
    project: null,
    requested_by: { id: 'profile-1', full_name: 'Juan' },
    ...overrides,
  } as PrototypeWorkspaceRowWithRelations
}

// ---------------------------------------------------------------------------
// buildPrototypeShareUrl
// ---------------------------------------------------------------------------

test('buildPrototypeShareUrl returns null for missing token', () => {
  assert.equal(buildPrototypeShareUrl(null), null)
  assert.equal(buildPrototypeShareUrl(''), null)
  assert.equal(buildPrototypeShareUrl('   '), null)
})

test('buildPrototypeShareUrl uses the default Production base when env var is unset', () => {
  const previous = process.env.NOON_WEBSITE_PUBLIC_BASE_URL
  delete process.env.NOON_WEBSITE_PUBLIC_BASE_URL
  try {
    const url = buildPrototypeShareUrl('abc')
    assert.equal(url, 'https://noon-main.vercel.app/es/maxwell/prototipo/abc')
  } finally {
    if (previous !== undefined) process.env.NOON_WEBSITE_PUBLIC_BASE_URL = previous
  }
})

test('buildPrototypeShareUrl honors NOON_WEBSITE_PUBLIC_BASE_URL override', () => {
  const previous = process.env.NOON_WEBSITE_PUBLIC_BASE_URL
  process.env.NOON_WEBSITE_PUBLIC_BASE_URL = 'https://preview-7.noon.app/'
  try {
    const url = buildPrototypeShareUrl('abc', { locale: 'en' })
    assert.equal(url, 'https://preview-7.noon.app/en/maxwell/prototipo/abc')
  } finally {
    if (previous === undefined) {
      delete process.env.NOON_WEBSITE_PUBLIC_BASE_URL
    } else {
      process.env.NOON_WEBSITE_PUBLIC_BASE_URL = previous
    }
  }
})

// ---------------------------------------------------------------------------
// mapPrototypeWorkspaceListItemRowToWire — shareUrl gating
// ---------------------------------------------------------------------------

test('mapper surfaces shareUrl for a ready non-superseded workspace', () => {
  const wire = mapPrototypeWorkspaceListItemRowToWire(workspaceRow())
  assert.equal(wire.shareToken, 'token-abc-123')
  assert.ok(wire.shareUrl?.includes('/maxwell/prototipo/token-abc-123'))
})

test('mapper surfaces shareUrl for delivery_active too', () => {
  const wire = mapPrototypeWorkspaceListItemRowToWire(
    workspaceRow({ status: 'delivery_active' }),
  )
  assert.ok(wire.shareUrl?.includes('/maxwell/prototipo/token-abc-123'))
})

test('mapper suppresses shareUrl while the workspace is pending_generation', () => {
  // Token already exists (RPC populates it pre-completion), but the iframe
  // target is null — sharing the URL would render an empty NoonWeb portal.
  const wire = mapPrototypeWorkspaceListItemRowToWire(
    workspaceRow({ status: 'pending_generation' }),
  )
  assert.equal(wire.shareToken, 'token-abc-123')
  assert.equal(wire.shareUrl, null)
})

test('mapper suppresses shareUrl when the token is superseded', () => {
  // Regenerate-V2 marked V1 as superseded; the V1 URL would 410 on
  // prototype-signed-read (ADR-024 §6.6). Hide the affordance.
  const wire = mapPrototypeWorkspaceListItemRowToWire(
    workspaceRow({ share_token_superseded_at: '2026-05-27T11:00:00.000Z' }),
  )
  assert.equal(wire.shareUrl, null)
})

test('mapper suppresses shareUrl when share_token itself is null', () => {
  const wire = mapPrototypeWorkspaceListItemRowToWire(
    workspaceRow({ share_token: null }),
  )
  assert.equal(wire.shareToken, null)
  assert.equal(wire.shareUrl, null)
})

test('mapper suppresses shareUrl while status is archived', () => {
  const wire = mapPrototypeWorkspaceListItemRowToWire(
    workspaceRow({ status: 'archived' }),
  )
  assert.equal(wire.shareUrl, null)
})
