import assert from 'node:assert/strict'
import test from 'node:test'
import { allocateLeads, nicheMaxForIteration } from '@/lib/server/maxwell/lead-engine'

// Architecture C1 (frozen): deterministic per-niche cap.
//
// Global cap: 5 leads per request.
// - 0 niches (generic) or 1 niche: cap = 5.
// - 2 niches, first iteration: cap = min(3, remaining) — leaves room for B.
// - 2 niches, second iteration: cap = remaining — absorbs A's leftover slack.

test('generic mode (0 niches) allocates the full 5 to a single bucket', () => {
  assert.equal(nicheMaxForIteration(0, 0, 0), 5)
})

test('single-niche mode allocates the full 5 to that niche', () => {
  assert.equal(nicheMaxForIteration(1, 0, 0), 5)
})

test('two niches: first iteration is capped at 3', () => {
  assert.equal(nicheMaxForIteration(2, 0, 0), 3)
})

test('two niches: second iteration absorbs remaining budget (canonical 3+2)', () => {
  assert.equal(nicheMaxForIteration(2, 1, 3), 2)
})

test('two niches: A=0 → B absorbs all 5 (single-niche-equivalent fallback)', () => {
  assert.equal(nicheMaxForIteration(2, 1, 0), 5)
})

test('two niches: A=1 → B absorbs 4 (A=1+B=4 still totals 5)', () => {
  assert.equal(nicheMaxForIteration(2, 1, 1), 4)
})

test('two niches: A=4 (impossible under cap 3, but defensive) → B gets 1', () => {
  assert.equal(nicheMaxForIteration(2, 1, 4), 1)
})

test('two niches: already at 5 published → second iteration receives 0', () => {
  assert.equal(nicheMaxForIteration(2, 1, 5), 0)
})

test('overflow guard: returns 0, never a negative budget', () => {
  assert.equal(nicheMaxForIteration(2, 1, 7), 0)
  assert.equal(nicheMaxForIteration(1, 0, 9), 0)
})

// ---------------------------------------------------------------------------
// Architecture C1 full tie-break: allocateLeads()
// ---------------------------------------------------------------------------

// Test fixtures only need the score that allocateLeads reads
// (`audit.scoring.total`); the rest of the PublishableEntry shape is
// irrelevant to the allocation logic under test. The helper returns `any`
// so callsites stay readable without per-line `@ts-expect-error` noise.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entry = (score: number): any => ({
  audit: { scoring: { total: score } },
  candidate: {},
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pool(...scores: number[]): any[] {
  return scores
    .map(entry)
    .sort((a, b) => b.audit.scoring.total - a.audit.scoring.total)
}

test('allocateLeads: no pools → empty', () => {
  assert.deepEqual(allocateLeads([]), [])
})

test('allocateLeads: single pool — capped at 5', () => {
  assert.deepEqual(allocateLeads([{ nicheId: 'restaurante', pool: pool(85, 80, 75, 70, 65, 60) }]), [5])
  assert.deepEqual(allocateLeads([{ nicheId: 'restaurante', pool: pool(85, 80) }]), [2])
  assert.deepEqual(allocateLeads([{ nicheId: 'restaurante', pool: [] }]), [0])
})

test('allocateLeads: both empty → [0, 0]', () => {
  assert.deepEqual(
    allocateLeads([
{ nicheId: 'restaurante', pool: [] },
{ nicheId: 'dental', pool: [] },
    ]),
    [0, 0],
  )
})

test('allocateLeads: one empty — the other absorbs all 5', () => {
  assert.deepEqual(
    allocateLeads([
{ nicheId: 'restaurante', pool: [] },
{ nicheId: 'dental', pool: pool(90, 85, 80, 75, 70, 65) },
    ]),
    [0, 5],
  )
})

test('allocateLeads: both ≥3 — tie-break by topScore (A wins)', () => {
  // A has top 95, B has top 85 → A gets 3, B gets 2
  assert.deepEqual(
    allocateLeads([
{ nicheId: 'restaurante', pool: pool(95, 80, 70) },
{ nicheId: 'dental', pool: pool(85, 80, 75) },
    ]),
    [3, 2],
  )
})

test('allocateLeads: both ≥3 — tie-break by topScore (B wins)', () => {
  assert.deepEqual(
    allocateLeads([
{ nicheId: 'restaurante', pool: pool(80, 75, 70) },
{ nicheId: 'dental', pool: pool(99, 70, 65) },
    ]),
    [2, 3],
  )
})

test('allocateLeads: both ≥3 — tied topScore → lexicographic nicheId wins (smaller takes 3)', () => {
  // 'dental' < 'restaurante' alphabetically → dental gets 3
  assert.deepEqual(
    allocateLeads([
{ nicheId: 'restaurante', pool: pool(90, 85, 80) },
{ nicheId: 'dental', pool: pool(90, 85, 80) },
    ]),
    [2, 3],
  )

  // Reverse the order: A is now lex-smaller → A gets 3
  assert.deepEqual(
    allocateLeads([
{ nicheId: 'dental', pool: pool(90, 85, 80) },
{ nicheId: 'restaurante', pool: pool(90, 85, 80) },
    ]),
    [3, 2],
  )
})

test('allocateLeads: A=4 candidates (under 3-cap), B=1 → absorption [3, 1] = 4 total', () => {
  assert.deepEqual(
    allocateLeads([
{ nicheId: 'restaurante', pool: pool(95, 88, 80, 70) },
{ nicheId: 'dental', pool: pool(75) },
    ]),
    [3, 1],
  )
})

test('allocateLeads: A=1, B=4 → [1, 4] = 5 total (slack absorbed by B)', () => {
  assert.deepEqual(
    allocateLeads([
{ nicheId: 'restaurante', pool: pool(80) },
{ nicheId: 'dental', pool: pool(95, 88, 82, 75) },
    ]),
    [1, 4],
  )
})

test('allocateLeads: A=2, B=2 → [2, 2] = 4 total (both below 3-cap, no slack)', () => {
  assert.deepEqual(
    allocateLeads([
{ nicheId: 'restaurante', pool: pool(85, 80) },
{ nicheId: 'dental', pool: pool(75, 70) },
    ]),
    [2, 2],
  )
})
