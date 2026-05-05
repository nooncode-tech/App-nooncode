import { NextResponse } from 'next/server'
import { z } from 'zod'
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { computePricing, formatPricingTable, type ProjectType, type Complexity } from '@/lib/maxwell/pricing'

const requestSchema = z.object({
  url: z.string().url(),
  channel: z.enum(['inbound', 'outbound']).default('inbound'),
})

const analysisSchema = z.object({
  headline: z.string().describe('One-sentence hook about what could be improved'),
  summary: z.string().describe('2-3 sentence description of what the site currently does and its state'),
  opportunities: z.array(z.object({
    title: z.string(),
    description: z.string(),
    impact: z.enum(['high', 'medium', 'low']),
    category: z.enum(['performance', 'design', 'seo', 'mobile', 'features', 'security', 'content']),
  })).min(2).max(6),
  projectType: z.enum(['landing', 'ecommerce', 'webapp', 'mobile', 'saas_ai']),
  complexity: z.enum(['low', 'medium', 'high']),
  isSpecialCase: z.boolean(),
  specialCaseReason: z.string().optional(),
})

async function fetchSiteContent(url: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NoonAnalyzer/1.0)',
        'Accept': 'text/html',
      },
    })
    clearTimeout(timeout)

    const html = await res.text()
    // Strip scripts, styles, and excessive whitespace to reduce token count
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // Limit to ~6000 chars to stay within token limits
    return stripped.slice(0, 6000)
  } catch {
    clearTimeout(timeout)
    return ''
  }
}

export async function POST(request: Request) {
  try {
    await requireRole(['admin', 'sales_manager', 'sales'])
    const body = requestSchema.parse(await request.json())

    const siteContent = await fetchSiteContent(body.url)

    const { object } = await generateObject({
      model: openai('gpt-4o-mini'),
      schema: analysisSchema,
      system: `Eres un consultor experto en desarrollo web y estrategia digital para la empresa Noon.
Analizas sitios web y detectas oportunidades de mejora que Noon puede ofrecer como servicios.

Clasifica el tipo de proyecto más relevante para la mejora:
- landing: sitio informativo, landing page, portfolio, corporate
- ecommerce: tienda online, catálogo con carrito, marketplace básico
- webapp: sistema interno, plataforma con lógica de negocio, CRM
- mobile: app móvil iOS/Android
- saas_ai: SaaS, automatizaciones, integración de IA

Casos especiales (isSpecialCase = true): marketplace complejo, legacy migration, blockchain, game development, compliance fuerte.

${formatPricingTable()}

Responde siempre en español. Sé directo y comercial — el objetivo es generar una propuesta de venta.`,
      prompt: `Analiza este sitio web: ${body.url}

Contenido extraído del sitio:
${siteContent || '(No se pudo obtener contenido — analiza solo por la URL)'}

Identifica las principales oportunidades de mejora que Noon podría ofrecer como proyecto de desarrollo.`,
    })

    const pricing = computePricing(
      object.projectType as ProjectType,
      object.complexity as Complexity,
      body.channel,
    )

    return NextResponse.json({
      data: {
        ...object,
        pricing,
        url: body.url,
        channel: body.channel,
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
