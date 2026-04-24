'use client'

import { useState } from 'react'
import { useData } from '@/lib/data-context'
import type { Lead, LeadStatus } from '@/lib/types'
import { KanbanBoard, type KanbanColumn } from '@/components/kanban-board'
import {
  selectLeadScoreColor,
  selectPipelineBoardSummary,
  selectPipelineColumnStats,
} from '@/lib/dashboard-selectors'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LeadDetail } from '@/components/lead-detail'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { Building2, Plus } from 'lucide-react'
import { LeadFormDialog } from '@/components/lead-form-dialog'
import { toast } from 'sonner'

export default function PipelinePage() {
  const { leads, isLeadsLoading, updateLeadStatus } = useData()
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [showNewLeadDialog, setShowNewLeadDialog] = useState(false)

  const { columns, totalPipelineValue } = selectPipelineBoardSummary(leads)

  const handleDragEnd = async (
    itemId: string,
    _sourceColumnId: string,
    targetColumnId: string
  ) => {
    try {
      await updateLeadStatus(itemId, targetColumnId as LeadStatus)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo mover el lead')
    }
  }

  const handleStatusChange = async (leadId: string, newStatus: LeadStatus) => {
    try {
      const updatedLead = await updateLeadStatus(leadId, newStatus)
      if (selectedLead?.id === leadId) {
        setSelectedLead(updatedLead)
      }
      return updatedLead
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el lead')
      throw error
    }
  }

  const renderCard = (lead: Lead, isDragging: boolean) => (
    <PipelineCard
      lead={lead}
      isDragging={isDragging}
      onClick={() => !isDragging && setSelectedLead(lead)}
    />
  )

  const getColumnStats = (column: KanbanColumn<Lead>) => selectPipelineColumnStats(column.items)

  return (
    <div className="flex h-full flex-col px-4 py-5 md:px-8 md:py-8">
      <div className="app-page-header shrink-0">
        <div>
          <h1 className="app-page-title">Pipeline de ventas</h1>
          <p className="app-page-subtitle">Arrastra leads entre etapas para actualizar su estado.</p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <div className="text-right">
            <p className="metric-label">Valor total</p>
            <p className="metric-value mt-1">${totalPipelineValue.toLocaleString()}</p>
          </div>
          <Button onClick={() => setShowNewLeadDialog(true)}>
            <Plus className="size-4 mr-2" />
            Nuevo Lead
          </Button>
        </div>
      </div>
      <div className="mt-6 flex flex-1 flex-col overflow-hidden">

      {/* Kanban Board */}
      {isLeadsLoading ? (
        <Card className="flex-1">
          <CardContent className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3">
            <Spinner className="size-8" />
            <p className="text-muted-foreground">Cargando pipeline...</p>
          </CardContent>
        </Card>
      ) : (
        <KanbanBoard
          columns={columns}
          onDragEnd={handleDragEnd}
          renderCard={renderCard}
          getColumnStats={getColumnStats}
        />
      )}

      {/* Lead Detail Dialog */}
      <Dialog open={!!selectedLead} onOpenChange={() => setSelectedLead(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del Lead</DialogTitle>
            <DialogDescription>
              Informacion completa y acciones disponibles
            </DialogDescription>
          </DialogHeader>
          {selectedLead && (
            <LeadDetail
              lead={selectedLead}
              onStatusChange={handleStatusChange}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* New Lead Dialog */}
      <LeadFormDialog
        open={showNewLeadDialog}
        onOpenChange={setShowNewLeadDialog}
      />
      </div>
    </div>
  )
}

interface PipelineCardProps {
  lead: Lead
  isDragging: boolean
  onClick: () => void
}

function PipelineCard({ lead, isDragging, onClick }: PipelineCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group bg-background rounded-lg border border-transparent px-2.5 py-2 cursor-pointer",
        "transition-colors duration-100 hover:bg-muted/20",
        isDragging && "ring-2 ring-primary/40 opacity-95"
      )}
    >
      {/* Row 1: name + score */}
      <div className="flex items-center justify-between gap-1.5 mb-1">
        <span className="text-xs font-semibold truncate leading-tight">{lead.name}</span>
        <span className={cn('text-[10px] font-bold px-1 py-px rounded shrink-0 tabular-nums', selectLeadScoreColor(lead.score))}>
          {lead.score}
        </span>
      </div>
      {/* Row 2: company (if any) */}
      {lead.company && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1 truncate mb-1">
          <Building2 className="size-2.5 shrink-0" />
          <span className="truncate">{lead.company}</span>
        </p>
      )}
      {/* Row 3: value + tag */}
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-semibold text-primary tabular-nums">
          ${lead.value.toLocaleString()}
        </span>
        {lead.tags.length > 0 && (
          <span className="text-[9px] font-medium px-1 py-px rounded bg-muted text-muted-foreground truncate max-w-[60px]">
            {lead.tags[0]}
          </span>
        )}
      </div>
    </div>
  )
}
