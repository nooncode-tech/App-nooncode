/**
 * GDPR Art. 15 — Right of Access export script.
 *
 * Produces a single JSON artefact containing every row across the PII
 * inventory that references the target `user_profiles` row. Read-only.
 *
 * Usage (see --help):
 *   tsx scripts/gdpr/export-user-data.ts \
 *     (--email <addr> | --profile-id <uuid>) \
 *     --output <path-to-write> \
 *     [--ticket <ticket-ref>]
 *
 * Required env (in `.env.local`):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Exit codes:
 *   0 — success, file written
 *   1 — env / CLI validation error
 *   2 — profile not found
 *   3 — Supabase query failure
 *   4 — output file write error
 *
 * TODO(system-docs): operator runbook at docs/runbooks/gdpr-art-15-17.md
 *   should reference this script with the exact CLI invocation and the
 *   retention rule (90 days per ADR-019 §D6).
 *
 * @see docs/adrs/ADR-019-gdpr-erasure-anonymization-policy.md
 * @see specs/fase-3-b16-gdpr-art-15-17.md
 */

import { writeFile } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'

import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'

import { getPhase1AAdminEnv } from '../../lib/env'
import {
  ProfileNotFoundError,
  countExportRows,
  exportUserData,
  resolveProfileIdByEmail,
} from '../../lib/server/gdpr/export'
import type { Database } from '../../lib/server/supabase/database.types'

loadEnvConfig(process.cwd())

const HELP_TEXT = `
GDPR Art. 15 — Right of Access export

USAGE
  tsx scripts/gdpr/export-user-data.ts (--email <addr> | --profile-id <uuid>) \\
      --output <path> [--ticket <ticket-ref>]

REQUIRED ENV
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

FLAGS
  --email <addr>          Resolve target by email (lower-cased internally)
  --profile-id <uuid>     Resolve target by user_profiles.id
  --output <path>         Where to write the JSON artefact
  --ticket <ticket-ref>   Optional support ticket reference for audit trail
  --help                  Show this help

EXIT CODES
  0  success
  1  env / CLI validation error
  2  profile not found
  3  Supabase query failure
  4  output file write error

NOTES
  - Read-only. Safe to re-run. Output filename convention:
      gdpr-export-<profile-id>-<ISO8601-utc>.json
  - The output file is the artefact you deliver to the data subject.
  - 90-day retention applies on the operator machine (ADR-019 §D6).
  - See docs/runbooks/gdpr-art-15-17.md for the operator runbook.
`

interface ParsedArgs {
  email: string | null
  profileId: string | null
  output: string | null
  ticket: string | null
  showHelp: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    email: null,
    profileId: null,
    output: null,
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
      case '--output':
        parsed.output = argv[++i] ?? null
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

function validateArgs(args: ParsedArgs): { profileLookup: { email?: string; profileId?: string }; output: string; ticket: string | null } {
  if ((args.email && args.profileId) || (!args.email && !args.profileId)) {
    throw new Error('Exactly one of --email or --profile-id is required.')
  }
  if (!args.output) {
    throw new Error('--output <path> is required.')
  }
  return {
    profileLookup: args.email
      ? { email: args.email }
      : { profileId: args.profileId ?? undefined },
    output: args.output,
    ticket: args.ticket,
  }
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
    console.error(`[gdpr-export] ${err instanceof Error ? err.message : String(err)}`)
    console.error('Run with --help for usage.')
    return 1
  }

  let env: ReturnType<typeof getPhase1AAdminEnv>
  try {
    env = getPhase1AAdminEnv()
  } catch (err) {
    console.error(`[gdpr-export] ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const client = createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })

  // Resolve profile-id.
  let profileId: string | null = validated.profileLookup.profileId ?? null
  if (validated.profileLookup.email) {
    try {
      profileId = await resolveProfileIdByEmail(client, validated.profileLookup.email)
    } catch (err) {
      console.error(`[gdpr-export] ${err instanceof Error ? err.message : String(err)}`)
      return 3
    }
  }

  if (!profileId) {
    console.error(
      `[gdpr-export] Profile not found for ${
        validated.profileLookup.email ?? validated.profileLookup.profileId
      }.`,
    )
    return 2
  }

  // Run export.
  let artefact
  try {
    artefact = await exportUserData(client, profileId, { ticketRef: validated.ticket })
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      console.error(`[gdpr-export] ${err.message}`)
      return 2
    }
    console.error(`[gdpr-export] ${err instanceof Error ? err.message : String(err)}`)
    return 3
  }

  // Write file.
  const outputPath = resolvePath(validated.output)
  try {
    const serialized = JSON.stringify(artefact, null, 2)
    await writeFile(outputPath, serialized, 'utf-8')
  } catch (err) {
    console.error(`[gdpr-export] Failed to write ${outputPath}: ${err instanceof Error ? err.message : String(err)}`)
    return 4
  }

  const totalRows = countExportRows(artefact)
  const tableCount = artefact.gdpr_export_metadata.inventory_tables_covered.length
  console.log(`Exported ${totalRows} rows across ${tableCount} tables to ${outputPath}.`)
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[gdpr-export] Unexpected failure: ${message}`)
    process.exitCode = 3
  })
