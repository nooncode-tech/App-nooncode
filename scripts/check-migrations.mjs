#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Single source of truth for the grandfathered prefix-collision set. Pinned
// to ADR-006 §Option B2 and shared with the migrations-health endpoint per
// ADR-017 §D1.
import { KNOWN_COLLISION_FILES } from '../lib/server/migrations/known-exceptions.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const PREFIX_RE = /^(\d{4})_/;

const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql'));

const malformed = [];
const byPrefix = new Map();

for (const file of files) {
  const match = file.match(PREFIX_RE);
  if (!match) {
    malformed.push(file);
    continue;
  }
  const prefix = match[1];
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
  byPrefix.get(prefix).push(file);
}

const newCollisions = [];
const grandfathered = [];

for (const [prefix, group] of byPrefix) {
  if (group.length <= 1) continue;
  const allKnown = group.every((f) => KNOWN_COLLISION_FILES.has(f));
  if (allKnown) {
    grandfathered.push({ prefix, group });
  } else {
    newCollisions.push({ prefix, group });
  }
}

if (grandfathered.length > 0) {
  console.log(`Known historical collisions (grandfathered per ADR-006):`);
  for (const { prefix, group } of grandfathered.sort((a, b) => a.prefix.localeCompare(b.prefix))) {
    console.log(`  ${prefix}_*  ->  ${group.sort().join(', ')}`);
  }
}

let exitCode = 0;

if (malformed.length > 0) {
  console.error(`\nERROR: ${malformed.length} migration file(s) without a 4-digit prefix:`);
  for (const f of malformed.sort()) console.error(`  ${f}`);
  exitCode = 1;
}

if (newCollisions.length > 0) {
  console.error(`\nERROR: ${newCollisions.length} new migration prefix collision(s):`);
  for (const { prefix, group } of newCollisions.sort((a, b) => a.prefix.localeCompare(b.prefix))) {
    console.error(`  ${prefix}_*  ->  ${group.sort().join(', ')}`);
  }
  console.error(`\nUse the next free prefix (>= 0043). If a collision is intentional and historical,`);
  console.error(`add the file names to KNOWN_COLLISION_FILES in scripts/check-migrations.mjs.`);
  exitCode = 1;
}

if (exitCode === 0) {
  const summary = grandfathered.length > 0
    ? `${files.length} migration file(s) checked. No new collisions (${grandfathered.length} grandfathered).`
    : `${files.length} migration file(s) checked. No collisions.`;
  console.log(`\nOK: ${summary}`);
}

process.exit(exitCode);
