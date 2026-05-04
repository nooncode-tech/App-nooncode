import { openai } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/server/supabase/database.types'
import type { AuthenticatedPrincipal } from '@/lib/server/profiles/types'
import type { LeadInsert, LeadRowWithProfiles } from '@/lib/server/leads/types'
import { ApiError } from '@/lib/server/api/errors'
import { createLead } from '@/lib/server/leads/repository'

type DatabaseClient = SupabaseClient<Database>

export const maxwellLeadSearchRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('current_location'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    locale: z.string().trim().min(2).max(20).optional(),
  }),
  z.object({
    mode: z.literal('manual_zone'),
    zoneText: z.string().trim().min(3).max(200),
    locale: z.string().trim().min(2).max(20).optional(),
  }),
])

const maxwellFeedbackSchema = z.object({
  rating: z.enum(['good', 'bad', 'duplicate', 'not_relevant']),
  note: z.string().trim().max(1000).optional().nullable(),
})

export type MaxwellFeedbackInput = z.infer<typeof maxwellFeedbackSchema>

export function parseMaxwellFeedbackInput(payload: unknown): MaxwellFeedbackInput {
  return maxwellFeedbackSchema.parse(payload)
}

const maxwellAuditSchema = z.object({
  results: z.array(z.object({
    candidateId: z.string(),
    publishable: z.boolean(),
    rejectionReason: z.string().optional(),
    business: z.object({
      name: z.string().min(1),
      industry: z.string().min(1),
      description: z.string().optional(),
      address: z.string().optional(),
      website: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      socials: z.array(z.string()).default([]),
    }),
    audit: z.object({
      summary: z.string().min(1),
      mainPain: z.string().min(1),
      pains: z.array(z.object({
        title: z.string().min(1),
        evidence: z.string().min(1),
        impact: z.string().min(1),
        confidence: z.enum(['high', 'medium', 'low']),
      })).min(1).max(4),
      sourcesChecked: z.array(z.string().min(1)).min(1),
      competitorNotes: z.string().optional(),
    }),
    opportunity: z.object({
      noonOpportunity: z.string().min(1),
      suggestedSolution: z.string().min(1),
      developmentType: z.string().min(1),
      prototypeIdea: z.string().min(1),
      recommendedNextAction: z.string().min(1),
    }),
    scoring: z.object({
      digitalPain: z.number().int().min(0).max(25),
      operationalPain: z.number().int().min(0).max(20),
      commercialPotential: z.number().int().min(0).max(20),
      contactQuality: z.number().int().min(0).max(10),
      distance: z.number().int().min(0).max(10),
      competitiveGap: z.number().int().min(0).max(15),
      total: z.number().int().min(0).max(100),
      priority: z.enum(['high', 'medium']),
      rationale: z.string().min(1),
    }),
    confidence: z.enum(['high', 'medium', 'low']),
    objections: z.array(z.object({
      objection: z.string().min(1),
      response: z.string().min(1),
    })).min(1).max(4),
    salesSpeech: z.object({
      language: z.string().min(2).max(20),
      tone: z.literal('consultative_helpful_local'),
      inPerson: z.string().min(1),
      phoneCall: z.string().min(1),
      whatsapp: z.string().min(1),
      audioEnabled: z.literal(true),
      audioProvider: z.literal('device_tts'),
      mustNotSoundLikeSales: z.literal(true),
      estimatedDurationSeconds: z.object({
        inPerson: z.number().int().min(35).max(90),
        phoneCall: z.number().int().min(15).max(50),
      }),
    }),
  })).max(20),
})

interface Candidate {
  id: string
  name: string
  category: string
  latitude: number
  longitude: number
  address?: string
  phone?: string
  email?: string
  website?: string
  socials: string[]
  tags: Record<string, string>
  dedupeKey: string
  sourceUrl?: string
}

interface CenterPoint {
  latitude: number
  longitude: number
  label?: string
}

interface SearchCounts {
  candidatesFound: number
  candidatesAudited: number
  duplicatesFound: number
  rejected: number
  published: number
}

export interface MaxwellLeadSearchResult {
  runId: string
  status: 'completed' | 'insufficient' | 'needs_review' | 'failed'
  leads: LeadRowWithProfiles[]
  counts: SearchCounts
  radiusKm: number
  message: string
}

function normalizeLocale(locale: string | undefined): string {
  const normalized = locale?.trim()
  if (!normalized) return 'es-MX'
  return normalized.slice(0, 20)
}

export function radiusKmForConfirmedSales(confirmedSales: number): number {
  if (confirmedSales <= 2) return 5
  if (confirmedSales <= 7) return 10
  if (confirmedSales <= 15) return 20
  if (confirmedSales <= 30) return 35
  return 50
}

function privilegedRadiusForRole(role: AuthenticatedPrincipal['role']): number | null {
  if (role === 'admin' || role === 'pm') return 100
  if (role === 'sales_manager') return 75
  return null
}

async function getAllowedRadiusKm(client: DatabaseClient, principal: AuthenticatedPrincipal): Promise<number> {
  const privilegedRadius = privilegedRadiusForRole(principal.role)
  if (privilegedRadius) return privilegedRadius

  const { data, error } = await client.rpc('maxwell_confirmed_sales_count', {
    p_profile_id: principal.userId,
  })

  if (error) {
    throw new ApiError(
      'MAXWELL_RADIUS_UNAVAILABLE',
      `Could not calculate seller radius: ${error.message}`,
      500
    )
  }

  return radiusKmForConfirmedSales(Number(data ?? 0))
}

function normalizePhone(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\D/g, '')
  return normalized && normalized.length >= 7 ? normalized : undefined
}

function normalizeWebsite(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined

  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
    return url.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return undefined
  }
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function buildDedupeKey(candidate: Pick<Candidate, 'name' | 'latitude' | 'longitude' | 'phone' | 'website'>): string {
  const website = normalizeWebsite(candidate.website)
  if (website) return `website:${website}`

  const phone = normalizePhone(candidate.phone)
  if (phone) return `phone:${phone}`

  return `geo:${normalizeName(candidate.name)}:${candidate.latitude.toFixed(3)}:${candidate.longitude.toFixed(3)}`
}

function getTag(tags: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const value = tags[name]?.trim()
    if (value) return value
  }
  return undefined
}

function readCategory(tags: Record<string, string>): string {
  return (
    getTag(tags, ['shop', 'amenity', 'tourism', 'office', 'craft', 'healthcare', 'leisure']) ??
    'business'
  ).replaceAll('_', ' ')
}

function readAddress(tags: Record<string, string>): string | undefined {
  const street = getTag(tags, ['addr:street'])
  const number = getTag(tags, ['addr:housenumber'])
  const city = getTag(tags, ['addr:city'])
  const parts = [`${street ?? ''} ${number ?? ''}`.trim(), city].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : undefined
}

function mapOverpassElement(element: {
  id: number
  type: string
  lat?: number
  lon?: number
  center?: { lat?: number; lon?: number }
  tags?: Record<string, string>
}): Candidate | null {
  const tags = element.tags ?? {}
  const name = tags.name?.trim()
  const latitude = element.lat ?? element.center?.lat
  const longitude = element.lon ?? element.center?.lon
  if (!name || latitude === undefined || longitude === undefined) return null

  const website = getTag(tags, ['contact:website', 'website', 'url'])
  const phone = getTag(tags, ['contact:phone', 'phone'])
  const email = getTag(tags, ['contact:email', 'email'])
  const socials = [
    getTag(tags, ['contact:instagram', 'instagram']),
    getTag(tags, ['contact:facebook', 'facebook']),
  ].filter((value): value is string => Boolean(value))

  const candidate = {
    id: `${element.type}/${element.id}`,
    name,
    category: readCategory(tags),
    latitude,
    longitude,
    address: readAddress(tags),
    phone,
    email,
    website,
    socials,
    tags,
    dedupeKey: '',
    sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
  }

  return {
    ...candidate,
    dedupeKey: buildDedupeKey(candidate),
  }
}

async function geocodeZone(zoneText: string): Promise<CenterPoint | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', zoneText)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '1')

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'NoonApp-MaxwellLeadEngine/1.0',
    },
  })

  if (!response.ok) return null

  const json = await response.json().catch(() => null) as Array<{
    lat?: string
    lon?: string
    display_name?: string
  }> | null
  const first = Array.isArray(json) ? json[0] : null
  if (!first?.lat || !first.lon) return null

  return {
    latitude: Number(first.lat),
    longitude: Number(first.lon),
    label: first.display_name ?? zoneText,
  }
}

async function fetchCandidates(center: CenterPoint, radiusKm: number): Promise<Candidate[]> {
  const radiusMeters = Math.min(radiusKm, 100) * 1000
  const around = `${radiusMeters},${center.latitude},${center.longitude}`
  const query = `
    [out:json][timeout:15];
    (
      node["name"]["amenity"](around:${around});
      node["name"]["shop"](around:${around});
      node["name"]["tourism"](around:${around});
      node["name"]["office"](around:${around});
      node["name"]["craft"](around:${around});
      node["name"]["healthcare"](around:${around});
      way["name"]["amenity"](around:${around});
      way["name"]["shop"](around:${around});
      way["name"]["tourism"](around:${around});
      way["name"]["office"](around:${around});
      relation["name"]["amenity"](around:${around});
      relation["name"]["shop"](around:${around});
    );
    out center tags 80;
  `

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': 'NoonApp-MaxwellLeadEngine/1.0',
    },
    body: new URLSearchParams({ data: query }),
  })

  if (!response.ok) {
    return []
  }

  const payload = await response.json().catch(() => null) as {
    elements?: Array<{
      id: number
      type: string
      lat?: number
      lon?: number
      center?: { lat?: number; lon?: number }
      tags?: Record<string, string>
    }>
  } | null

  const candidates = (payload?.elements ?? [])
    .map(mapOverpassElement)
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .filter((candidate) => candidate.phone || candidate.email || candidate.website || candidate.socials.length > 0)

  const uniqueByKey = new Map<string, Candidate>()
  for (const candidate of candidates) {
    if (!uniqueByKey.has(candidate.dedupeKey)) {
      uniqueByKey.set(candidate.dedupeKey, candidate)
    }
  }
  return Array.from(uniqueByKey.values())
}

async function findDuplicateKeys(adminClient: DatabaseClient, candidates: Candidate[]): Promise<Set<string>> {
  const keys = Array.from(new Set(candidates.map((candidate) => candidate.dedupeKey)))
  if (keys.length === 0) return new Set()

  const { data, error } = await adminClient
    .from('leads')
    .select('maxwell_dedupe_key')
    .in('maxwell_dedupe_key', keys)

  if (error) {
    throw new ApiError('MAXWELL_DEDUPE_FAILED', `Could not check duplicates: ${error.message}`, 500)
  }

  return new Set((data ?? []).map((row) => row.maxwell_dedupe_key).filter(Boolean) as string[])
}

function chunkCandidates(candidates: Candidate[], size: number): Candidate[][] {
  const chunks: Candidate[][] = []
  for (let index = 0; index < candidates.length; index += size) {
    chunks.push(candidates.slice(index, index + size))
  }
  return chunks
}

async function auditCandidates(candidates: Candidate[], locale: string, radiusKm: number) {
  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: maxwellAuditSchema,
    system: `Eres Maxwell Lead Engine V1 para NoonApp outbound.
Tu trabajo es auditar negocios candidatos y devolver solo oportunidades accionables para sellers.
No inventes datos. Usa solo la informacion publica provista por OpenStreetMap y marca inferencias como probables.
No prometas resultados garantizados. No uses tono agresivo.
Publica solo si hay dolor claro, evidencia observable, solucion concreta para Noon, canal de contacto util y score >= 60.
Genera sales_speech en el idioma solicitado (${locale}) cuando sea viable, con tono consultivo, local y sin presion.
El score total usa: dolor digital 25, dolor operativo 20, potencial comercial 20, contacto 10, cercania 10, brecha competitiva 15.`,
    prompt: JSON.stringify({
      locale,
      radiusKm,
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.id,
        name: candidate.name,
        category: candidate.category,
        address: candidate.address,
        contact: {
          phone: candidate.phone,
          email: candidate.email,
          website: candidate.website,
          socials: candidate.socials,
        },
        sourceUrl: candidate.sourceUrl,
        tags: candidate.tags,
      })),
      requiredSalesSpeechFormula: [
        'saludo breve',
        'contexto local',
        'observacion o dolor detectado',
        'posible mejora',
        'solucion sugerida por Noon',
        'sin compromiso',
        'invitacion suave',
      ],
    }),
  })

  return object.results
}

function hasUsefulContact(candidate: Candidate, audit: Awaited<ReturnType<typeof auditCandidates>>[number]): boolean {
  return Boolean(
    candidate.phone ||
    candidate.email ||
    candidate.website ||
    candidate.socials.length > 0 ||
    audit.business.phone ||
    audit.business.email ||
    audit.business.website ||
    audit.business.socials.length > 0
  )
}

function buildLeadInsert(
  principal: AuthenticatedPrincipal,
  runId: string,
  candidate: Candidate,
  audit: Awaited<ReturnType<typeof auditCandidates>>[number]
): LeadInsert {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()
  const snapshot = {
    business: {
      ...audit.business,
      website: audit.business.website ?? candidate.website,
      phone: audit.business.phone ?? candidate.phone,
      email: audit.business.email ?? candidate.email,
      socials: audit.business.socials.length > 0 ? audit.business.socials : candidate.socials,
    },
    audit: audit.audit,
    opportunity: audit.opportunity,
    scoring: audit.scoring,
    confidence: audit.confidence,
    objections: audit.objections,
    salesSpeech: audit.salesSpeech,
    source: {
      provider: 'openstreetmap_overpass',
      externalId: candidate.id,
      dedupeKey: candidate.dedupeKey,
      generatedAt: now,
    },
  }

  return {
    name: audit.business.name || candidate.name,
    email: audit.business.email ?? candidate.email ?? null,
    phone: audit.business.phone ?? candidate.phone ?? null,
    whatsapp: normalizePhone(audit.business.phone ?? candidate.phone) ?? null,
    company: audit.business.name || candidate.name,
    source: 'maxwell',
    status: 'new',
    score: audit.scoring.total,
    value: 0,
    assigned_to: principal.userId,
    created_by: principal.userId,
    notes: audit.audit.summary,
    tags: ['maxwell', 'cercano', audit.scoring.priority === 'high' ? 'alta-prioridad' : 'oportunidad-valida'],
    location_text: audit.business.address ?? candidate.address ?? null,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    lead_origin: 'outbound',
    publication_status: 'published',
    maxwell_snapshot: snapshot as Json,
    maxwell_search_run_id: runId,
    maxwell_expires_at: expiresAt,
    maxwell_last_refreshed_at: now,
    maxwell_dedupe_key: candidate.dedupeKey,
    maxwell_confidence: audit.confidence,
  }
}

async function updateRun(
  client: DatabaseClient,
  runId: string,
  updates: Database['public']['Tables']['maxwell_search_runs']['Update']
) {
  const { error } = await client
    .from('maxwell_search_runs')
    .update(updates)
    .eq('id', runId)

  if (error) {
    throw new ApiError('MAXWELL_RUN_UPDATE_FAILED', `Could not update Maxwell run: ${error.message}`, 500)
  }
}

async function assertDailySearchLimit(client: DatabaseClient, principal: AuthenticatedPrincipal) {
  if (principal.role !== 'sales') return

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { count, error } = await client
    .from('maxwell_search_runs')
    .select('id', { count: 'exact', head: true })
    .eq('requested_by', principal.userId)
    .gte('created_at', today.toISOString())

  if (error) {
    throw new ApiError('MAXWELL_SEARCH_LIMIT_UNAVAILABLE', error.message, 500)
  }

  if ((count ?? 0) >= 3) {
    throw new ApiError(
      'MAXWELL_DAILY_LIMIT_REACHED',
      'Ya usaste las 3 busquedas diarias de Maxwell Lead Engine V1.',
      429
    )
  }
}

export async function runMaxwellLeadSearch(params: {
  request: z.infer<typeof maxwellLeadSearchRequestSchema>
  principal: AuthenticatedPrincipal
  serverClient: DatabaseClient
  adminClient: DatabaseClient
  acceptLanguage?: string | null
}): Promise<MaxwellLeadSearchResult> {
  const { request, principal, serverClient, adminClient } = params
  const locale = normalizeLocale(request.locale ?? params.acceptLanguage?.split(',')[0])

  await assertDailySearchLimit(serverClient, principal)

  const radiusKm = await getAllowedRadiusKm(serverClient, principal)
  const baseCenter: CenterPoint | null = request.mode === 'current_location'
    ? { latitude: request.latitude, longitude: request.longitude }
    : await geocodeZone(request.zoneText)

  const { data: run, error: runError } = await serverClient
    .from('maxwell_search_runs')
    .insert({
      requested_by: principal.userId,
      mode: request.mode,
      center_latitude: baseCenter?.latitude ?? null,
      center_longitude: baseCenter?.longitude ?? null,
      zone_text: request.mode === 'manual_zone' ? request.zoneText : null,
      radius_km: radiusKm,
      locale,
      status: 'running',
      stage: baseCenter ? 'searching_candidates' : 'detecting_location',
    })
    .select('id')
    .single()

  if (runError || !run) {
    throw new ApiError('MAXWELL_RUN_CREATE_FAILED', runError?.message ?? 'Could not create Maxwell run.', 500)
  }

  const runId = run.id
  const counts: SearchCounts = {
    candidatesFound: 0,
    candidatesAudited: 0,
    duplicatesFound: 0,
    rejected: 0,
    published: 0,
  }

  try {
  if (!baseCenter) {
    const message = 'No se pudo resolver la ubicacion o zona manual. Ajusta la zona y vuelve a intentar.'
    await updateRun(serverClient, runId, {
      status: 'insufficient',
      stage: 'completed',
      message,
      completed_at: new Date().toISOString(),
    })

    return { runId, status: 'insufficient', leads: [], counts, radiusKm, message }
  }

  const candidates = await fetchCandidates(baseCenter, radiusKm)
  counts.candidatesFound = candidates.length

  await updateRun(serverClient, runId, {
    stage: 'filtering_candidates',
    candidates_found: counts.candidatesFound,
  })

  if (candidates.length === 0) {
    const message = 'Maxwell no encontro candidatos con canal publico util dentro del radio permitido.'
    await updateRun(serverClient, runId, {
      status: 'insufficient',
      stage: 'completed',
      message,
      candidates_found: counts.candidatesFound,
      completed_at: new Date().toISOString(),
    })

    return { runId, status: 'insufficient', leads: [], counts, radiusKm, message }
  }

  const duplicateKeys = await findDuplicateKeys(adminClient, candidates)
  counts.duplicatesFound = duplicateKeys.size
  const uniqueCandidates = candidates.filter((candidate) => !duplicateKeys.has(candidate.dedupeKey))
  const publishedLeads: LeadRowWithProfiles[] = []

  for (const candidateChunk of chunkCandidates(uniqueCandidates.slice(0, 60), 20).slice(0, 3)) {
    if (publishedLeads.length >= 5) break

    await updateRun(serverClient, runId, {
      stage: 'auditing_businesses',
      candidates_audited: counts.candidatesAudited,
      duplicates_found: counts.duplicatesFound,
    })

    const audits = await auditCandidates(candidateChunk, locale, radiusKm)
    counts.candidatesAudited += candidateChunk.length

    for (const audit of audits) {
      if (publishedLeads.length >= 5) break

      const candidate = candidateChunk.find((item) => item.id === audit.candidateId)
      if (!candidate) {
        counts.rejected += 1
        continue
      }

      const isValid =
        audit.publishable &&
        audit.scoring.total >= 60 &&
        audit.audit.pains.length > 0 &&
        audit.audit.mainPain.trim().length > 0 &&
        audit.opportunity.suggestedSolution.trim().length > 0 &&
        hasUsefulContact(candidate, audit)

      if (!isValid) {
        counts.rejected += 1
        continue
      }

      const lead = await createLead(serverClient, buildLeadInsert(principal, runId, candidate, audit))
      publishedLeads.push(lead)
      counts.published += 1
    }
  }

  const status = publishedLeads.length >= 3 ? 'completed' : publishedLeads.length > 0 ? 'insufficient' : 'insufficient'
  const message = publishedLeads.length >= 3
    ? `Maxwell publico ${publishedLeads.length} oportunidades accionables dentro de tu radio.`
    : publishedLeads.length > 0
      ? `Maxwell encontro ${publishedLeads.length} lead(s) validos, pero marco la busqueda como leads insuficientes para no publicar basura.`
      : 'Maxwell audito candidatos, pero ninguno cumplio score, evidencia y canal suficiente.'

  await updateRun(serverClient, runId, {
    status,
    stage: 'completed',
    candidates_found: counts.candidatesFound,
    candidates_audited: counts.candidatesAudited,
    duplicates_found: counts.duplicatesFound,
    leads_rejected: counts.rejected,
    leads_published: counts.published,
    message,
    completed_at: new Date().toISOString(),
  })

  return { runId, status, leads: publishedLeads, counts, radiusKm, message }
  } catch (error) {
    await updateRun(serverClient, runId, {
      status: 'failed',
      stage: 'completed',
      candidates_found: counts.candidatesFound,
      candidates_audited: counts.candidatesAudited,
      duplicates_found: counts.duplicatesFound,
      leads_rejected: counts.rejected,
      leads_published: counts.published,
      error_message: error instanceof Error ? error.message : 'Unknown Maxwell Lead Engine failure',
      completed_at: new Date().toISOString(),
    })
    throw error
  }
}
