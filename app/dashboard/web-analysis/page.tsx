'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Globe,
  Search,
  AlertTriangle,
  TrendingUp,
  Smartphone,
  Shield,
  Zap,
  Type,
  Star,
  ArrowRight,
  Loader2,
  DollarSign,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { PROJECT_TYPE_LABELS, COMPLEXITY_LABELS } from '@/lib/maxwell/pricing'
import type { PricingResult, ProjectType, Complexity } from '@/lib/maxwell/pricing'

type ImpactLevel = 'high' | 'medium' | 'low'
type OpportunityCategory = 'performance' | 'design' | 'seo' | 'mobile' | 'features' | 'security' | 'content'

interface Opportunity {
  title: string
  description: string
  impact: ImpactLevel
  category: OpportunityCategory
}

interface AnalysisResult {
  headline: string
  summary: string
  opportunities: Opportunity[]
  projectType: ProjectType
  complexity: Complexity
  isSpecialCase: boolean
  specialCaseReason?: string
  pricing: PricingResult
  url: string
  channel: 'inbound' | 'outbound'
}

const categoryIcons: Record<OpportunityCategory, React.ReactNode> = {
  performance: <Zap className="size-4" />,
  design: <Star className="size-4" />,
  seo: <Search className="size-4" />,
  mobile: <Smartphone className="size-4" />,
  features: <TrendingUp className="size-4" />,
  security: <Shield className="size-4" />,
  content: <Type className="size-4" />,
}

const categoryLabels: Record<OpportunityCategory, string> = {
  performance: 'Performance',
  design: 'Diseño',
  seo: 'SEO',
  mobile: 'Mobile',
  features: 'Funcionalidades',
  security: 'Seguridad',
  content: 'Contenido',
}

const impactConfig: Record<ImpactLevel, { label: string; color: string }> = {
  high: { label: 'Alto impacto', color: 'bg-red-500/10 text-red-700 border-red-200' },
  medium: { label: 'Medio impacto', color: 'bg-amber-500/10 text-amber-700 border-amber-200' },
  low: { label: 'Bajo impacto', color: 'bg-sky-500/10 text-sky-700 border-sky-200' },
}

function buildMaxwellUrl(result: AnalysisResult): string {
  const params = new URLSearchParams({
    url: result.url,
    type: result.projectType,
    complexity: result.complexity,
    headline: result.headline,
  })
  return `/dashboard/leads?maxwell=web-analysis&${params.toString()}`
}

export default function WebAnalysisPage() {
  const [url, setUrl] = useState('')
  const [channel, setChannel] = useState<'inbound' | 'outbound'>('inbound')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)

  const handleAnalyze = async () => {
    const trimmed = url.trim()
    if (!trimmed) {
      toast.error('Ingresa una URL')
      return
    }

    const normalized = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`

    try {
      new URL(normalized)
    } catch {
      toast.error('URL inválida')
      return
    }

    setIsAnalyzing(true)
    setResult(null)

    try {
      const res = await fetch('/api/web-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized, channel }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Error al analizar el sitio')
      }

      const { data } = await res.json()
      setResult(data)
      setUrl(normalized)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al analizar el sitio')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const sortedOpportunities = result
    ? [...result.opportunities].sort((a, b) => {
        const order: Record<ImpactLevel, number> = { high: 0, medium: 1, low: 2 }
        return order[a.impact] - order[b.impact]
      })
    : []

  return (
    <div className="app-page mx-auto max-w-4xl">
      <div className="app-page-header">
        <div>
        <h1 className="app-page-title">Analisis de sitio web</h1>
        <p className="app-page-subtitle">
          Pega la URL de la web de un prospecto y genera oportunidades comerciales en segundos.
        </p>
      </div>
        </div>

      {/* Input Section */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 flex items-center gap-2 border rounded-md px-3 bg-background focus-within:ring-1 focus-within:ring-ring">
              <Globe className="size-4 text-muted-foreground shrink-0" />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isAnalyzing && handleAnalyze()}
                placeholder="https://ejemplo.com"
                className="border-0 px-0 focus-visible:ring-0"
              />
            </div>
            <Select value={channel} onValueChange={(v) => setChannel(v as 'inbound' | 'outbound')}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inbound">Inbound</SelectItem>
                <SelectItem value="outbound">Outbound</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleAnalyze} disabled={isAnalyzing} className="sm:w-auto w-full">
              {isAnalyzing ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Analizando...
                </>
              ) : (
                <>
                  <Search className="size-4 mr-2" />
                  Analizar
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading Skeleton */}
      {isAnalyzing && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <div className="space-y-3 animate-pulse">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-2/3" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Results */}
      {result && !isAnalyzing && (
        <div className="space-y-4">

          {/* Headline + Summary */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <CardTitle className="text-lg leading-tight">{result.headline}</CardTitle>
                {result.isSpecialCase && (
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-200 shrink-0">
                    <AlertTriangle className="size-3 mr-1" />
                    Caso especial
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <p className="text-sm text-muted-foreground">{result.summary}</p>
              {result.isSpecialCase && result.specialCaseReason && (
                <p className="text-sm text-amber-700 bg-amber-500/10 px-3 py-2 rounded-md">
                  {result.specialCaseReason}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant="outline">
                  {PROJECT_TYPE_LABELS[result.projectType]}
                </Badge>
                <Badge variant="outline">
                  Complejidad {COMPLEXITY_LABELS[result.complexity]}
                </Badge>
                <Badge variant="outline" className="capitalize">
                  {result.channel === 'outbound' ? 'Outbound' : 'Inbound'}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Opportunities */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Oportunidades de mejora</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {sortedOpportunities.map((opp, i) => (
                <div key={i} className="flex gap-3 rounded-md bg-muted/20 p-3">
                  <div className="size-8 rounded-md bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                    {categoryIcons[opp.category]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-sm">{opp.title}</span>
                      <Badge variant="outline" className={`text-xs ${impactConfig[opp.impact].color}`}>
                        {impactConfig[opp.impact].label}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {categoryLabels[opp.category]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{opp.description}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Pricing */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="size-4" />
                Cotización sugerida
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-md bg-muted/20 p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Activación</p>
                  <p className="metric-value">${result.pricing.activationFinal}</p>
                  {result.pricing.isOutbound && (
                    <p className="text-xs text-muted-foreground mt-1">
                      (base ${result.pricing.activationBase} + $100 seller)
                    </p>
                  )}
                </div>
                <div className="rounded-md bg-muted/20 p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Membresía mensual</p>
                  <p className="metric-value">${result.pricing.membership}</p>
                  <p className="text-xs text-muted-foreground mt-1">/ mes</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Separator />

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              className="flex-1"
              onClick={() => {
                const domain = new URL(result.url).hostname.replace('www.', '')
                const msg = encodeURIComponent(
                  `Analicé el sitio ${result.url}. Es un proyecto tipo "${PROJECT_TYPE_LABELS[result.projectType]}" con complejidad ${COMPLEXITY_LABELS[result.complexity]}. ` +
                  `Las principales oportunidades son: ${result.opportunities.slice(0, 3).map(o => o.title).join(', ')}. ` +
                  `Quiero generar una propuesta con activación $${result.pricing.activationFinal} y membresía $${result.pricing.membership}/mes. ` +
                  `El lead es de ${domain}.`
                )
                window.location.href = `/dashboard/leads?maxwell=1&msg=${msg}`
              }}
            >
              <Sparkles className="size-4 mr-2" />
              Abrir en Maxwell
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                const domain = new URL(result.url).hostname.replace('www.', '')
                const params = new URLSearchParams({
                  newLead: '1',
                  company: domain,
                  notes: `Sitio analizado: ${result.url}. ${result.summary}`,
                })
                window.location.href = `/dashboard/leads?${params.toString()}`
              }}
            >
              <ArrowRight className="size-4 mr-2" />
              Crear Lead desde análisis
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
