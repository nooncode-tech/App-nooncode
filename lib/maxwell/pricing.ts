export type ProjectType = 'landing' | 'ecommerce' | 'webapp' | 'mobile' | 'saas_ai'
export type Complexity = 'low' | 'medium' | 'high'
export type Channel = 'inbound' | 'outbound'

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  landing:   'Web básica / Landing / Corporate',
  ecommerce: 'E-commerce',
  webapp:    'Web App / Sistema',
  mobile:    'Mobile',
  saas_ai:   'SaaS / AI / Automation',
}

export const COMPLEXITY_LABELS: Record<Complexity, string> = {
  low:    'Bajo',
  medium: 'Medio',
  high:   'Alto',
}

const ACTIVATION: Record<ProjectType, Record<Complexity, number>> = {
  landing:   { low: 49,  medium: 79,  high: 129 },
  ecommerce: { low: 79,  medium: 129, high: 199 },
  webapp:    { low: 99,  medium: 179, high: 279 },
  mobile:    { low: 129, medium: 199, high: 299 },
  saas_ai:   { low: 129, medium: 229, high: 349 },
}

const MEMBERSHIP: Record<ProjectType, Record<Complexity, number>> = {
  landing:   { low: 25, medium: 32,  high: 49  },
  ecommerce: { low: 39, medium: 55,  high: 79  },
  webapp:    { low: 49, medium: 69,  high: 109 },
  mobile:    { low: 49, medium: 69,  high: 109 },
  saas_ai:   { low: 69, medium: 99,  high: 149 },
}

const SPECIAL_CASE_KEYWORDS = [
  'marketplace', 'legacy', 'offline', 'sync', 'compliance',
  'migraci', 'blockchain', 'game', 'gaming',
]

export interface PricingResult {
  activationBase: number
  activationFinal: number
  membership: number
  sellerFee: number
  isOutbound: boolean
}

export function computePricing(
  projectType: ProjectType,
  complexity: Complexity,
  channel: Channel,
): PricingResult {
  const activationBase = ACTIVATION[projectType][complexity]
  const membership = MEMBERSHIP[projectType][complexity]
  const isOutbound = channel === 'outbound'
  const sellerFee = isOutbound ? 100 : 0
  const activationFinal = isOutbound ? activationBase + sellerFee : activationBase

  return { activationBase, activationFinal, membership, sellerFee, isOutbound }
}

export function detectSpecialCase(description: string): boolean {
  const lower = description.toLowerCase()
  return SPECIAL_CASE_KEYWORDS.some((kw) => lower.includes(kw))
}

export function formatPricingTable(): string {
  const types: ProjectType[] = ['landing', 'ecommerce', 'webapp', 'mobile', 'saas_ai']
  const complexities: Complexity[] = ['low', 'medium', 'high']

  let table = '### Tabla de Activación (precio único inicial)\n'
  table += '| Tipo | Bajo | Medio | Alto |\n|---|---|---|---|\n'
  for (const t of types) {
    table += `| ${PROJECT_TYPE_LABELS[t]} | $${ACTIVATION[t].low} | $${ACTIVATION[t].medium} | $${ACTIVATION[t].high} |\n`
  }

  table += '\n### Tabla de Membresía (mensual)\n'
  table += '| Tipo | Bajo | Medio | Alto |\n|---|---|---|---|\n'
  for (const t of types) {
    table += `| ${PROJECT_TYPE_LABELS[t]} | $${MEMBERSHIP[t].low} | $${MEMBERSHIP[t].medium} | $${MEMBERSHIP[t].high} |\n`
  }

  return table
}
