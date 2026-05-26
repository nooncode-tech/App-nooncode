'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import {
  NICHE_FAMILIES,
  getNicheById,
  getNichesByFamily,
} from '@/lib/server/maxwell/niches'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface NicheSelectorProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  maxSelections: number
  disabled?: boolean
  className?: string
}

/**
 * Maxwell Lead Engine niche selector — controlled, 2-level (family → micro-niche).
 *
 * Architecture C6 (frozen):
 * - Pure controlled component. Parent owns selectedIds, fetching and persistence.
 * - One family expanded at a time (collapses the previously expanded one).
 * - When selectedIds.length >= maxSelections, unselected micro-niches render
 *   as disabled; already-selected ones remain clickable to deselect.
 * - Data-only catalog imported from lib/server/maxwell/niches (safe for client).
 */
export function NicheSelector({
  selectedIds,
  onChange,
  maxSelections,
  disabled = false,
  className,
}: NicheSelectorProps) {
  const [expandedFamily, setExpandedFamily] = useState<string | null>(null)

  const atCapacity = selectedIds.length >= maxSelections

  const handleToggleFamily = (familyId: string) => {
    if (disabled) return
    setExpandedFamily((current) => (current === familyId ? null : familyId))
  }

  const handleToggleNiche = (nicheId: string) => {
    if (disabled) return
    const isSelected = selectedIds.includes(nicheId)

    if (isSelected) {
      onChange(selectedIds.filter((id) => id !== nicheId))
      return
    }

    if (atCapacity) {
      // Capacity check — guard against accidental selection past the cap.
      return
    }

    onChange([...selectedIds, nicheId])
  }

  const handleRemoveSelected = (nicheId: string) => {
    if (disabled) return
    onChange(selectedIds.filter((id) => id !== nicheId))
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Counter + selected chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {selectedIds.length} / {maxSelections} seleccionados
        </span>
        {selectedIds.map((id) => {
          const niche = getNicheById(id)
          if (!niche) {
            // Defensive: unknown id (catalog drift). Render minimal chip.
            return (
              <Badge
                key={id}
                variant="outline"
                className="gap-1 border-dashed text-muted-foreground"
              >
                Nicho desconocido
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => handleRemoveSelected(id)}
                    aria-label={`Quitar nicho desconocido ${id}`}
                    className="ml-0.5 rounded-sm hover:bg-muted-foreground/10"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </Badge>
            )
          }
          return (
            <Badge key={id} variant="secondary" className="gap-1">
              {niche.label}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemoveSelected(id)}
                  aria-label={`Quitar ${niche.label}`}
                  className="ml-0.5 rounded-sm hover:bg-foreground/10"
                >
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          )
        })}
      </div>

      {/* Family chips */}
      <div className="flex flex-wrap gap-2">
        {NICHE_FAMILIES.map((family) => {
          const isExpanded = expandedFamily === family.id
          const familyNiches = getNichesByFamily(family.id)
          const familySelectedCount = familyNiches.filter((n) =>
            selectedIds.includes(n.id),
          ).length
          return (
            <Button
              key={family.id}
              type="button"
              variant={isExpanded ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleToggleFamily(family.id)}
              disabled={disabled}
              aria-expanded={isExpanded}
              aria-controls={`niche-family-panel-${family.id}`}
              className="h-auto py-1.5 px-3 text-xs"
            >
              <span>{family.label}</span>
              {familySelectedCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-2 h-4 min-w-4 px-1 text-[10px]"
                >
                  {familySelectedCount}
                </Badge>
              )}
              {isExpanded ? (
                <ChevronUp className="size-3 ml-1" />
              ) : (
                <ChevronDown className="size-3 ml-1" />
              )}
            </Button>
          )
        })}
      </div>

      {/* Expanded micro-niches panel */}
      {expandedFamily && (
        <div
          id={`niche-family-panel-${expandedFamily}`}
          role="region"
          aria-label="Micro-nichos disponibles"
          className="rounded-lg border bg-muted/30 p-3"
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {getNichesByFamily(expandedFamily).map((niche) => {
              const isSelected = selectedIds.includes(niche.id)
              const isDisabled = disabled || (!isSelected && atCapacity)
              return (
                <Label
                  key={niche.id}
                  htmlFor={`niche-${niche.id}`}
                  className={cn(
                    'flex items-start gap-2 rounded-md border bg-background p-2 cursor-pointer transition-colors',
                    isSelected && 'border-primary bg-primary/5',
                    isDisabled && 'cursor-not-allowed opacity-50',
                    !isDisabled && !isSelected && 'hover:bg-muted',
                  )}
                >
                  <Checkbox
                    id={`niche-${niche.id}`}
                    checked={isSelected}
                    onCheckedChange={() => handleToggleNiche(niche.id)}
                    disabled={isDisabled}
                    aria-label={niche.label}
                  />
                  <span className="text-sm leading-tight">{niche.label}</span>
                </Label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
