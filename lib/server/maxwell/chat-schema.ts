import type { UIMessage } from 'ai'
import { z } from 'zod'

const maxwellUiMessageSchema = z.object({
  id: z.string().max(200).optional(),
  role: z.enum(['system', 'user', 'assistant']),
  content: z.unknown().optional(),
  parts: z.array(z.unknown()).optional(),
}).passthrough().refine(
  (message) => message.content !== undefined || message.parts !== undefined,
  'Message must include content or parts.'
)

export const maxwellChatRequestSchema = z.object({
  messages: z.array(maxwellUiMessageSchema).min(1).max(40),
  leadId: z.string().uuid().optional(),
  leadName: z.string().trim().min(1).max(180).optional(),
  channel: z.string().trim().min(1).max(80).optional(),
}).strict()

export type MaxwellChatRequest = z.infer<typeof maxwellChatRequestSchema> & {
  messages: UIMessage[]
}
