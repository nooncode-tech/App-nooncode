import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildClientView,
  findLeakedFieldNames,
  sanitizeForClient,
} from '@/lib/security/project-isolation'

// Coverage for lib/security/project-isolation.ts. Positive-allowlist
// sanitization primitive per ADR-024 D4 §"Sanitization" + Lista App item #4
// (mirror v3 contracts).

test('project-isolation: sanitizeForClient picks only allowlisted keys', () => {
  const row = {
    id: 'x',
    name: 'Acme',
    notes: 'INTERNAL CRM NOTE',
    score: 99,
    created_by: 'admin-uuid',
  }

  const safe = sanitizeForClient(row, ['id', 'name'])

  assert.deepEqual(safe, { id: 'x', name: 'Acme' })
  assert.equal('notes' in safe, false)
  assert.equal('score' in safe, false)
  assert.equal('created_by' in safe, false)
})

test('project-isolation: sanitizeForClient does NOT mutate the source', () => {
  const row = { id: 'x', name: 'A', secret: 'leak' }
  const before = JSON.stringify(row)

  sanitizeForClient(row, ['id'])

  assert.equal(JSON.stringify(row), before, 'source row must not be mutated')
})

test('project-isolation: sanitizeForClient preserves null but excludes missing keys', () => {
  const row = { id: 'x', name: null as string | null, label: undefined }

  const safe = sanitizeForClient(row, ['id', 'name'])

  assert.equal(safe.id, 'x')
  assert.equal(safe.name, null)
  assert.equal('label' in safe, false)
})

test('project-isolation: sanitizeForClient handles empty allowlist (yields empty object)', () => {
  const safe = sanitizeForClient({ a: 1, b: 2 }, [])
  assert.deepEqual(safe, {})
})

test('project-isolation: buildClientView delegates to mapper; output is the mapper return', () => {
  const row = {
    id: 'x',
    company: 'Acme Industries',
    name: 'Acme Contact',
    maxwell_snapshot: { project_type: 'landing' },
  }

  const out = buildClientView(row, (r) => ({
    workspace: { id: r.id },
    businessName: r.company ?? r.name,
    rawSnapshotPresent: typeof r.maxwell_snapshot === 'object',
  }))

  assert.equal(out.workspace.id, 'x')
  assert.equal(out.businessName, 'Acme Industries')
  assert.equal(out.rawSnapshotPresent, true)
  // No raw row fields leak.
  assert.equal('maxwell_snapshot' in out, false)
  assert.equal('company' in out, false)
})

test('project-isolation: buildClientView handles null-safe fallback chain', () => {
  const row: { id: string; company: string | null; name: string } = {
    id: 'y',
    company: null,
    name: 'Beta Contact',
  }

  const out = buildClientView(row, (r) => ({
    businessName: r.company ?? r.name,
  }))

  assert.equal(out.businessName, 'Beta Contact')
})

test('project-isolation: findLeakedFieldNames returns the leaked field names', () => {
  const safeBody = JSON.stringify({ data: { id: 'x', name: 'Acme' } })
  assert.deepEqual(
    findLeakedFieldNames(safeBody, ['notes', 'score', 'share_token']),
    [],
  )

  const leakyBody = JSON.stringify({
    data: { id: 'x', name: 'Acme', notes: 'INTERNAL', share_token: 'RAW' },
  })
  assert.deepEqual(
    findLeakedFieldNames(leakyBody, ['notes', 'share_token', 'score']),
    ['notes', 'share_token'],
  )
})

test('project-isolation: findLeakedFieldNames uses quoted-name match (avoids substring false positives)', () => {
  // A field VALUE that happens to contain a forbidden field NAME should NOT
  // trip the leak detector. We grep for `"name"` (quoted), not raw `name`.
  const body = JSON.stringify({ data: { description: 'has notes field' } })
  assert.deepEqual(findLeakedFieldNames(body, ['notes']), [])
})

test('project-isolation: type-narrowing — output keys are exactly the allowlist', () => {
  // Compile-time check via runtime shape. If `sanitizeForClient` types are
  // wrong, this would fail to compile in strict mode; runtime asserts the
  // shape contract.
  const row = { a: 1, b: 'two', c: true }
  const safe = sanitizeForClient(row, ['a', 'c'])

  assert.equal(safe.a, 1)
  assert.equal(safe.c, true)
  // TS narrowing means `safe` does NOT have `.b`; the runtime confirms.
  assert.equal('b' in safe, false)
})
