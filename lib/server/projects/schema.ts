import { z } from 'zod'

export const projectStatusSchema = z.enum([
  'backlog',
  'in_progress',
  'review',
  'delivered',
  'completed',
])

const legacyMockIdSchema = z.string().trim().min(1).max(64)

const optionalNullableText = z
  .string()
  .trim()
  .max(4000)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    clientName: z.string().trim().min(1).max(160).optional(),
    description: optionalNullableText.optional(),
    status: projectStatusSchema.optional(),
    budget: z.number().min(0).optional(),
    pmId: legacyMockIdSchema.nullable().optional(),
    teamIds: z.array(legacyMockIdSchema).max(12).optional(),
    startDate: z.string().date().nullable().optional(),
    endDate: z.string().date().nullable().optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'At least one field is required.',
  })
  .superRefine((payload, context) => {
    if (payload.startDate && payload.endDate && payload.endDate < payload.startDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'End date must be on or after start date.',
      })
    }
  })

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
