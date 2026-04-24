'use client'

import React from "react"

import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface KanbanColumn<T> {
  id: string
  title: string
  color: string
  items: T[]
}

interface KanbanBoardProps<T extends { id: string }> {
  columns: KanbanColumn<T>[]
  onDragEnd: (itemId: string, sourceColumnId: string, targetColumnId: string) => void
  renderCard: (item: T, isDragging: boolean) => React.ReactNode
  renderColumnFooter?: (column: KanbanColumn<T>) => React.ReactNode
  getColumnStats?: (column: KanbanColumn<T>) => React.ReactNode
}

export function KanbanBoard<T extends { id: string }>({
  columns,
  onDragEnd,
  renderCard,
  renderColumnFooter,
  getColumnStats,
}: KanbanBoardProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeColumn, setActiveColumn] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const findColumn = (id: string) => {
    for (const column of columns) {
      if (column.items.some((item) => item.id === id)) {
        return column
      }
    }
    return null
  }

  const findItem = (id: string) => {
    for (const column of columns) {
      const item = column.items.find((i) => i.id === id)
      if (item) return item
    }
    return null
  }

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    setActiveId(active.id as string)
    const column = findColumn(active.id as string)
    setActiveColumn(column?.id || null)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return

    const activeColumnObj = findColumn(active.id as string)
    const overColumnId = columns.find((c) => c.id === over.id)?.id || findColumn(over.id as string)?.id

    if (activeColumnObj && overColumnId && activeColumnObj.id !== overColumnId) {
      setActiveColumn(overColumnId)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over) {
      const sourceColumn = findColumn(active.id as string)
      const targetColumnId = columns.find((c) => c.id === over.id)?.id || findColumn(over.id as string)?.id

      if (sourceColumn && targetColumnId) {
        onDragEnd(active.id as string, sourceColumn.id, targetColumnId)
      }
    }

    setActiveId(null)
    setActiveColumn(null)
  }

  const activeItem = activeId ? findItem(activeId) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex-1 overflow-x-auto pb-2">
        <div className="flex gap-2 pb-4 min-w-max">
          {columns.map((column) => (
            <KanbanColumnComponent
              key={column.id}
              column={column}
              renderCard={renderCard}
              renderFooter={renderColumnFooter}
              getStats={getColumnStats}
              isOver={activeColumn === column.id && activeId !== null && findColumn(activeId)?.id !== column.id}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {activeItem ? (
          <div className="opacity-90 rotate-3 scale-105">
            {renderCard(activeItem, true)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

interface KanbanColumnProps<T extends { id: string }> {
  column: KanbanColumn<T>
  renderCard: (item: T, isDragging: boolean) => React.ReactNode
  renderFooter?: (column: KanbanColumn<T>) => React.ReactNode
  getStats?: (column: KanbanColumn<T>) => React.ReactNode
  isOver: boolean
}

function KanbanColumnComponent<T extends { id: string }>({
  column,
  renderCard,
  renderFooter,
  getStats,
  isOver,
}: KanbanColumnProps<T>) {
  return (
    <div className="flex-1 min-w-[170px] max-w-[240px]">
      <div className={cn(
        "h-full flex flex-col rounded-xl border bg-muted/20 transition-colors",
        isOver && "ring-1 ring-primary/40 bg-primary/[0.05]"
      )}>
        {/* Column header */}
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <div className={cn('size-2 rounded-full shrink-0', column.color)} />
              <span className="text-xs font-semibold text-foreground">{column.title}</span>
            </div>
            <span className="rounded-full border bg-background/80 px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              {column.items.length}
            </span>
          </div>
          {getStats && (
            <div className="text-xs text-muted-foreground">
              {getStats(column)}
            </div>
          )}
        </div>

        {/* Cards list */}
        <div className="flex-1 px-2 pb-2 overflow-y-auto">
          <SortableContext
            id={column.id}
            items={column.items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1.5 min-h-[120px]">
              {column.items.map((item) => (
                <SortableCard key={item.id} id={item.id}>
                  {renderCard(item, false)}
                </SortableCard>
              ))}
              {column.items.length === 0 && (
                <div className={cn(
                  "h-[80px] border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground/50 text-xs transition-colors",
                  isOver && "border-primary/50 bg-primary/5 text-primary"
                )}>
                  {isOver ? 'Suelta aquí' : 'Vacío'}
                </div>
              )}
            </div>
          </SortableContext>
          {renderFooter && (
            <div className="mt-2 pt-2 border-t">
              {renderFooter(column)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface SortableCardProps {
  id: string
  children: React.ReactNode
}

function SortableCard({ id, children }: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "touch-none",
        isDragging && "opacity-50"
      )}
    >
      {children}
    </div>
  )
}
