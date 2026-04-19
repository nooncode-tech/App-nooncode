import { z } from 'zod'

const leadStatusSchema = z.enum([
  'new',
  'contacted',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
])

const leadSourceSchema = z.enum([
  'website',
  'referral',
  'cold_call',
  'social',
  'event',
  'other',
  'cold_outreach',
  'social_media',
])

function normalizeLeadSource(source: z.infer<typeof leadSourceSchema>) {
  if (source === 'cold_outreach') {
    return 'cold_call'
  }

  if (source === 'social_media') {
    return 'social'
  }

  return source
}

const leadOriginSchema = z.enum(['inbound', 'outbound'])

const baseLeadShape = {
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(80).optional().nullable(),
  company: z.string().trim().max(160).optional().nullable(),
  source: leadSourceSchema.transform(normalizeLeadSource),
  status: leadStatusSchema,
  score: z.number().int().min(0).max(100),
  value: z.number().min(0),
  notes: z.string().trim().max(4000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(50)).max(12),
  assignedTo: z.string().uuid().optional().nullable(),
  lastContactedAt: z.string().datetime().optional().nullable(),
  nextFollowUpAt: z.string().datetime().optional().nullable(),
  locationText: z.string().trim().max(200).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  leadOrigin: leadOriginSchema,
}

export const createLeadSchema = z.object({
  ...baseLeadShape,
  status: baseLeadShape.status.default('new'),
  tags: baseLeadShape.tags.default([]),
  value: baseLeadShape.value.default(0),
})

export const updateLeadSchema = z
  .object({
    name: baseLeadShape.name.optional(),
    email: baseLeadShape.email.optional(),
    phone: baseLeadShape.phone,
    company: baseLeadShape.company,
    source: baseLeadShape.source.optional(),
    status: baseLeadShape.status.optional(),
    score: baseLeadShape.score.optional(),
    value: baseLeadShape.value.optional(),
    notes: baseLeadShape.notes,
    tags: baseLeadShape.tags.optional(),
    assignedTo: baseLeadShape.assignedTo,
    lastContactedAt: baseLeadShape.lastContactedAt,
    nextFollowUpAt: baseLeadShape.nextFollowUpAt,
    locationText: baseLeadShape.locationText,
    latitude: baseLeadShape.latitude,
    longitude: baseLeadShape.longitude,
    // lead_origin is intentionally excluded from updates — immutable after creation
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'At least one field is required.',
  })

export type CreateLeadInput = z.infer<typeof createLeadSchema>
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>
