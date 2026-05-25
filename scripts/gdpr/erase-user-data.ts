/**
 * GDPR Art. 17 — Right to Erasure script.
 *
 * DESTRUCTIVE. Default-safe: dry-run unless --execute is passed AND every
 * guard passes.
 *
 * Usage (see --help):
 *   tsx scripts/gdpr/erase-user-data.ts \
 *     (--email <addr> | --profile-id <uuid>) \
 *     --export-artefact <path-to-prior-export.json> \
 *     --reason <text> \
 *     [--execute] \
 *     [--allow-admin] \
 *     [--ticket <ticket-ref>]
 *
 * Required env (in `.env.local`):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1   (only required with --execute)
 *
 * Exit codes:
 *   0  success (dry-run printed, or live erase completed + verified)
 *   1  env / CLI validation error
 *   2  profile not found
 *   3  Supabase query failure (anonymization step rolled back caller-side)
 *   4  auth-side delete failure (anonymization already applied; see runbook)
 *   5  export artefact missing, malformed, or mismatched
 *   6  sentinel profile not seeded (apply migration 0057)
 *   7  destructive env var not set
 *   8  interactive confirmation mismatch
 *   9  admin target without --allow-admin
 *   10 post-erase verification mismatch
 *
 * TODO(system-docs): operator runbook at docs/runbooks/gdpr-art-15-17.md
 *   should reference this script with the exact --execute invocation and
 *   the recovery query for exit code 4.
 *
 * @see docs/adrs/ADR-019-gdpr-erasure-anonymization-policy.md
 * @see specs/fase-3-b16-gdpr-art-15-17.md
 */

import { appendFile, readFile } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'

import { getPhase1AAdminEnv } from '../../lib/env'
import {
  AdminTargetWithoutAllowError,
  EraseStepError,
  EraseVerificationError,
  SentinelTargetError,
  eraseUserData,
  planErase,
} from '../../lib/server/gdpr/erase'
import { resolveProfileIdByEmail } from '../../lib/server/gdpr/export'
import {
  SentinelNotSeededError,
  assertSentinelExists,
} from '../../lib/server/gdpr/sentinel'
import type { Database } from '../../lib/server/supabase/database.types'

loadEnvConfig(process.cwd())

const HELP_TEXT = `
GDPR Art. 17 — Right to Erasure (DESTRUCTIVE)

USAGE
  tsx scripts/gdpr/erase-user-data.ts (--email <addr> | --profile-id <uuid>) \\
      --export-artefact <path-to-prior-export.json> \\
      --reason <text> \\
      [--execute] [--allow-admin] [--ticket <ticket-ref>]

REQUIRED ENV
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1   (only required with --execute)

FLAGS
  --email <addr>             Resolve target by email
  --profile-id <uuid>        Resolve target by user_profiles.id
  --export-artefact <path>   Path to the JSON file produced by
                             scripts/gdpr/export-user-data.ts. The file's
                             gdpr_export_metadata.profile_id must match the
                             resolved target. Proves Art. 15 was satisfied first.
  --reason <text>            Free-text reason / ticket synopsis (audit trail)
  --execute                  Actually mutate. Without this flag, the script
                             prints a per-table plan and exits.
  --allow-admin              Required when the target has role='admin'
  --ticket <ticket-ref>      Optional support ticket reference
  --help                     Show this help

EXIT CODES
  0  success (dry-run printed, or live erase completed + verified)
  1  env / CLI validation error
  2  profile not found
  3  Supabase query failure during anonymization
  4  auth-side delete failure (anonymization already applied)
  5  export artefact missing, malformed, or mismatched
  6  sentinel profile not seeded (apply migration 0057)
  7  destructive env var not set
  8  interactive confirmation mismatch
  9  admin target without --allow-admin
  10 post-erase verification mismatch

GUARDS (all required for --execute):
  1. I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1 in environment
  2. --export-artefact pointing to a prior valid export for THIS profile
  3. Interactive typed confirmation: type the target email or profile-id
  4. Sentinel profile (UUID 00000000-...) pre-seeded by migration 0057
  5. If role='admin', --allow-admin must also be passed

DRY-RUN BEHAVIOR (no --execute):
  Prints a per-table plan: <table>: <verdict> (N rows would be <action>).
  No mutation. Safe.

LIVE RUN ORDER (ADR-019 §D2):
  1. Pre-flight checks (sentinel, admin guard, export-artefact match)
  2. ANONYMIZE-in-place pass per inventory
  3. Explicit DELETE for non-cascading CASCADE-delete tables (currently none)
  4. supabase.auth.admin.deleteUser(profileId) → cascades to user_profiles
  5. Post-verification queries

  See docs/runbooks/gdpr-art-15-17.md for full operator procedure.

AUDIT TRAIL
  Successful --execute appends to .gdpr-erasure-audit.log (gitignored).
`

interface ParsedArgs {
  email: string | null
  profileId: string | null
  exportArtefact: string | null
  reason: string | null
  execute: boolean
  allowAdmin: boolean
  ticket: string | null
  showHelp: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    email: null,
    profileId: null,
    exportArtefact: null,
    reason: null,
    execute: false,
    allowAdmin: false,
    ticket: null,
    showHelp: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--help':
      case '-h':
        parsed.showHelp = true
        break
      case '--email':
        parsed.email = argv[++i] ?? null
        break
      case '--profile-id':
        parsed.profileId = argv[++i] ?? null
        break
      case '--export-artefact':
        parsed.exportArtefact = argv[++i] ?? null
        break
      case '--reason':
        parsed.reason = argv[++i] ?? null
        break
      case '--execute':
        parsed.execute = true
        break
      case '--allow-admin':
        parsed.allowAdmin = true
        break
      case '--ticket':
        parsed.ticket = argv[++i] ?? null
        break
      default:
        if (arg && arg.startsWith('--')) {
          throw new Error(`Unknown flag: ${arg}`)
        }
    }
  }

  return parsed
}

function validateArgs(args: ParsedArgs): {
  profileLookup: { email?: string; profileId?: string }
  exportArtefact: string
  reason: string
  execute: boolean
  allowAdmin: boolean
  ticket: string | null
} {
  if ((args.email && args.profileId) || (!args.email && !args.profileId)) {
    throw new Error('Exactly one of --email or --profile-id is required.')
  }
  if (!args.exportArtefact) {
    throw new Error('--export-artefact <path> is required (proves Art. 15 was satisfied first).')
  }
  if (!args.reason) {
    throw new Error('--reason <text> is required for audit trail.')
  }
  return {
    profileLookup: args.email
      ? { email: args.email }
      : { profileId: args.profileId ?? undefined },
    exportArtefact: args.exportArtefact,
    reason: args.reason,
    execute: args.execute,
    allowAdmin: args.allowAdmin,
    ticket: args.ticket,
  }
}

interface ExportArtefactMetadataShape {
  schema_version: string
  profile_id: string
  email_at_export_time?: string
  full_name_at_export_time?: string
}

interface ExportArtefactShape {
  gdpr_export_metadata: ExportArtefactMetadataShape
  tables: Record<string, unknown[]>
}

async function readAndValidateArtefact(
  path: string,
  expectedProfileId: string,
): Promise<ExportArtefactShape> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err) {
    throw new Error(`Cannot read export artefact at ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Export artefact is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Export artefact root is not an object.')
  }

  const obj = parsed as Record<string, unknown>
  const metadata = obj.gdpr_export_metadata
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('Export artefact missing gdpr_export_metadata.')
  }

  const meta = metadata as Record<string, unknown>
  if (typeof meta.profile_id !== 'string') {
    throw new Error('Export artefact gdpr_export_metadata.profile_id is missing or not a string.')
  }

  if (meta.profile_id !== expectedProfileId) {
    throw new Error(
      `Export artefact profile_id mismatch: artefact has ${meta.profile_id}, ` +
        `expected ${expectedProfileId}. The export artefact must match the target.`,
    )
  }

  return obj as unknown as ExportArtefactShape
}

async function promptForConfirmation(
  email: string | null,
  profileId: string,
  fullName: string | null,
): Promise<string> {
  const rl = createInterface({ input, output })
  try {
    console.log('')
    console.log('--- CONFIRM TARGET ---')
    console.log(`  profile-id: ${profileId}`)
    console.log(`  email:      ${email ?? '(unknown)'}`)
    console.log(`  full_name:  ${fullName ?? '(unknown)'}`)
    console.log('')
    console.log('This will ANONYMIZE all ledger references and DELETE the auth user.')
    console.log('The action is NOT reversible.')
    console.log('')
    const answer = await rl.question(
      'Type the email or profile-id EXACTLY (case-sensitive) to confirm: ',
    )
    return answer
  } finally {
    rl.close()
  }
}

function isValidConfirmation(
  answer: string,
  email: string | null,
  profileId: string,
): boolean {
  if (!answer) return false
  if (answer === profileId) return true
  if (email && answer === email) return true
  return false
}

async function appendAuditLog(entry: {
  profileId: string
  email: string | null
  reason: string
  ticketRef: string | null
  verificationOk: boolean
}): Promise<void> {
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      profile_id: entry.profileId,
      email_at_run: entry.email,
      reason: entry.reason,
      ticket_ref: entry.ticketRef,
      verification_ok: entry.verificationOk,
    }) + '\n'
  const path = resolvePath(process.cwd(), '.gdpr-erasure-audit.log')
  await appendFile(path, line, 'utf-8')
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))

  if (args.showHelp) {
    console.log(HELP_TEXT.trim())
    return 0
  }

  let validated: ReturnType<typeof validateArgs>
  try {
    validated = validateArgs(args)
  } catch (err) {
    console.error(`[gdpr-erase] ${err instanceof Error ? err.message : String(err)}`)
    console.error('Run with --help for usage.')
    return 1
  }

  let env: ReturnType<typeof getPhase1AAdminEnv>
  try {
    env = getPhase1AAdminEnv()
  } catch (err) {
    console.error(`[gdpr-erase] ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const client = createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })

  // ----- Resolve target -----
  let profileId: string | null = validated.profileLookup.profileId ?? null
  const inputEmail = validated.profileLookup.email ?? null
  if (inputEmail) {
    try {
      profileId = await resolveProfileIdByEmail(client, inputEmail)
    } catch (err) {
      console.error(`[gdpr-erase] ${err instanceof Error ? err.message : String(err)}`)
      return 3
    }
  }
  if (!profileId) {
    console.error(
      `[gdpr-erase] Profile not found for ${inputEmail ?? validated.profileLookup.profileId}.`,
    )
    return 2
  }

  // ----- Validate export artefact -----
  try {
    await readAndValidateArtefact(validated.exportArtefact, profileId)
  } catch (err) {
    console.error(`[gdpr-erase] Export artefact check failed: ${err instanceof Error ? err.message : String(err)}`)
    return 5
  }

  // ----- Pre-flight: sentinel must exist (both for dry-run and live) -----
  try {
    await assertSentinelExists(client)
  } catch (err) {
    if (err instanceof SentinelNotSeededError) {
      console.error(`[gdpr-erase] ${err.message}`)
      return 6
    }
    console.error(`[gdpr-erase] Sentinel check failed: ${err instanceof Error ? err.message : String(err)}`)
    return 3
  }

  // ----- Read target's role + email + full_name (for admin guard + confirmation) -----
  const { data: targetProfile, error: profileReadError } = await client
    .from('user_profiles')
    .select('email, full_name, role')
    .eq('id', profileId)
    .maybeSingle()

  if (profileReadError) {
    console.error(`[gdpr-erase] Failed to read target profile: ${profileReadError.message}`)
    return 3
  }
  if (!targetProfile) {
    console.error(`[gdpr-erase] Target profile disappeared between resolve and read: ${profileId}`)
    return 2
  }

  if (targetProfile.role === 'admin' && !validated.allowAdmin) {
    console.error(
      `[gdpr-erase] Refusing to operate on admin profile ${profileId} ` +
        `without --allow-admin.`,
    )
    return 9
  }

  // ----- Dry-run: print plan and exit -----
  if (!validated.execute) {
    let plan
    try {
      plan = await planErase(client, profileId)
    } catch (err) {
      console.error(`[gdpr-erase] Plan generation failed: ${err instanceof Error ? err.message : String(err)}`)
      return 3
    }

    console.log('')
    console.log(`GDPR erase plan for ${profileId} (${targetProfile.email}) — DRY-RUN`)
    console.log('-'.repeat(80))
    for (const row of plan.per_table) {
      const actionLabel =
        row.planned_action === 'ANONYMIZE'
          ? 'ANONYMIZED-to-sentinel'
          : row.planned_action === 'DELETE'
            ? 'DELETED'
            : row.planned_action === 'EXPORT-only'
              ? 'EXPORT-only'
              : 'SKIPPED'
      console.log(
        `  ${row.table.padEnd(36)} ${row.verdict.padEnd(20)} ${String(row.row_count).padStart(6)} rows → ${actionLabel}`,
      )
    }
    console.log('')
    console.log('No mutations performed. Pass --execute to apply.')
    console.log('When applying:')
    console.log('  - I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1 must be set in env')
    console.log('  - You will be prompted to type the email or profile-id to confirm')
    return 0
  }

  // ----- Live run guards -----
  if (process.env.I_UNDERSTAND_THIS_IS_DESTRUCTIVE !== '1') {
    console.error(
      '[gdpr-erase] Refusing to --execute: I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1 ' +
        'must be set in the environment.',
    )
    return 7
  }

  const answer = await promptForConfirmation(
    targetProfile.email,
    profileId,
    targetProfile.full_name,
  )
  if (!isValidConfirmation(answer, targetProfile.email, profileId)) {
    console.error('[gdpr-erase] Confirmation mismatch. Aborting.')
    return 8
  }

  // ----- Execute -----
  let result
  try {
    result = await eraseUserData(client, profileId, {
      reason: validated.reason,
      ticketRef: validated.ticket,
      allowAdmin: validated.allowAdmin,
    })
  } catch (err) {
    if (err instanceof SentinelTargetError) {
      console.error(`[gdpr-erase] ${err.message}`)
      return 1
    }
    if (err instanceof AdminTargetWithoutAllowError) {
      console.error(`[gdpr-erase] ${err.message}`)
      return 9
    }
    if (err instanceof EraseStepError && err.step === 'auth-delete') {
      console.error(
        `[gdpr-erase] Anonymization succeeded but auth-side delete failed: ${err.message}`,
      )
      console.error('Re-run the auth delete only — see docs/runbooks/gdpr-art-15-17.md for the recovery query.')
      try {
        await appendAuditLog({
          profileId,
          email: targetProfile.email,
          reason: validated.reason,
          ticketRef: validated.ticket,
          verificationOk: false,
        })
      } catch {
        // best-effort
      }
      return 4
    }
    if (err instanceof EraseVerificationError) {
      console.error(`[gdpr-erase] ${err.message}`)
      try {
        await appendAuditLog({
          profileId,
          email: targetProfile.email,
          reason: validated.reason,
          ticketRef: validated.ticket,
          verificationOk: false,
        })
      } catch {
        // best-effort
      }
      return 10
    }
    console.error(`[gdpr-erase] Erase failed: ${err instanceof Error ? err.message : String(err)}`)
    return 3
  }

  // ----- Print verification table -----
  console.log('')
  console.log(`GDPR erase verification for ${profileId} — DONE`)
  console.log('-'.repeat(80))
  for (const row of result.per_table) {
    console.log(
      `  ${row.table.padEnd(36)} affected=${String(row.rows_affected).padStart(5)} ` +
        `remaining=${row.verification_remaining_for_original} ` +
        `sentinel=${row.verification_sentinel_count}`,
    )
  }
  console.log('')
  console.log(`auth.users deleted: ${result.auth_user_deleted}`)

  try {
    await appendAuditLog({
      profileId,
      email: targetProfile.email,
      reason: validated.reason,
      ticketRef: validated.ticket,
      verificationOk: true,
    })
  } catch (err) {
    console.warn(`[gdpr-erase] Audit log append failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[gdpr-erase] Unexpected failure: ${message}`)
    process.exitCode = 3
  })
