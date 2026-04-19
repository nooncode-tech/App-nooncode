'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { MaxwellChat } from '@/components/maxwell-chat'
import { cn } from '@/lib/utils'
import { Bot, X } from 'lucide-react'

export function MaxwellFab() {
  const [isOpen, setIsOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <>
      {/* Chat Window */}
      {isOpen && (
        <div
          className={cn(
            'fixed z-50 transition-all duration-300 ease-in-out',
            isExpanded
              ? 'inset-4 md:inset-8'
              : 'bottom-20 right-4 w-[380px] h-[550px] max-h-[calc(100vh-120px)]'
          )}
        >
          <MaxwellChat
            className="size-full shadow-2xl"
            onClose={() => {
              setIsOpen(false)
              setIsExpanded(false)
            }}
            isExpanded={isExpanded}
            onToggleExpand={() => setIsExpanded(!isExpanded)}
          />
        </div>
      )}

      {/* Floating Action Button */}
      <Button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'fixed bottom-4 right-4 z-50 size-14 rounded-full shadow-lg transition-all duration-200',
          'hover:scale-110 hover:shadow-xl',
          isOpen && 'bg-muted text-muted-foreground hover:bg-muted'
        )}
        size="icon"
      >
        {isOpen ? (
          <X className="size-6" />
        ) : (
          <Bot className="size-6" />
        )}
      </Button>

      {/* Backdrop for expanded mode */}
      {isOpen && isExpanded && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
          onClick={() => {
            setIsOpen(false)
            setIsExpanded(false)
          }}
        />
      )}
    </>
  )
}
