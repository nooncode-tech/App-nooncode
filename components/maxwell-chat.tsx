'use client'

import React from "react"

import { useState, useRef, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useAuth } from '@/lib/auth-context'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Send, Bot, User, Sparkles, Loader2, X, Maximize2, Minimize2, Info } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

interface MaxwellChatProps {
  className?: string
  onClose?: () => void
  isExpanded?: boolean
  onToggleExpand?: () => void
}

export function MaxwellChat({ className, onClose, isExpanded, onToggleExpand }: MaxwellChatProps) {
  const { authMode } = useAuth()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const isSupabaseMode = authMode === 'supabase'

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/maxwell' }),
  })

  const isLoading = status === 'streaming' || status === 'submitted'

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    sendMessage({ text: input })
    setInput('')
  }

  const suggestedPrompts = isSupabaseMode
    ? [
        'Ayudame a redactar un email comercial',
        'Mejora este mensaje para un cliente',
        'Dame una estructura de propuesta',
        'Ayudame a preparar una reunion',
      ]
    : [
        'Redacta un email de seguimiento',
        'Dame estrategias de cierre',
        'Ayudame con una propuesta',
        'Prioriza mis leads',
      ]

  return (
    <Card className={cn('flex flex-col bg-card', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-primary/5">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-full bg-primary flex items-center justify-center">
            <Bot className="size-5 text-primary-foreground" />
          </div>
          <div>
            <h3 className="font-semibold">Maxwell</h3>
            <p className="text-xs text-muted-foreground">
              {isSupabaseMode
                ? 'Asistente general sin contexto automatico del workspace'
                : 'Tu copiloto de ventas'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onToggleExpand && (
            <Button variant="ghost" size="icon" onClick={onToggleExpand}>
              {isExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0 p-4" ref={scrollRef}>
        <div className="space-y-4">
          {isSupabaseMode && (
            <Alert className="border-dashed bg-muted/40">
              <Info className="size-4" />
              <AlertTitle>Contexto manual requerido</AlertTitle>
              <AlertDescription>
                Maxwell puede ayudarte a redactar y pensar opciones, pero en este runtime no ve
                automaticamente tus leads, pipeline, reportes o configuraciones reales. Pega el
                contexto que quieras analizar dentro del chat.
              </AlertDescription>
            </Alert>
          )}

          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Sparkles className="size-8 text-primary" />
              </div>
              <h4 className="font-semibold mb-2">Hola, soy Maxwell</h4>
              <p className="text-sm text-muted-foreground mb-6 max-w-[280px]">
                {isSupabaseMode
                  ? 'Puedo ayudarte como asistente general para redactar, estructurar ideas y revisar texto si me compartes el contexto necesario.'
                  : 'Tu asistente de ventas con IA. Puedo ayudarte a redactar emails, crear propuestas y mas.'}
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {suggestedPrompts.map((prompt) => (
                  <Button
                    key={prompt}
                    variant="outline"
                    size="sm"
                    className="text-xs bg-transparent"
                    onClick={() => {
                      sendMessage({ text: prompt })
                    }}
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'flex gap-3',
                  message.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                )}
              >
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback className={cn(
                    message.role === 'user' 
                      ? 'bg-secondary text-secondary-foreground' 
                      : 'bg-primary text-primary-foreground'
                  )}>
                    {message.role === 'user' ? <User className="size-4" /> : <Bot className="size-4" />}
                  </AvatarFallback>
                </Avatar>
                <div
                  className={cn(
                    'rounded-lg px-3 py-2 max-w-[85%] text-sm',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  )}
                >
                  {message.parts.map((part, index) => {
                    if (part.type === 'text') {
                      return (
                        <div key={index} className="prose prose-sm dark:prose-invert max-w-none">
                          <ReactMarkdown>{part.text}</ReactMarkdown>
                        </div>
                      )
                    }
                    return null
                  })}
                </div>
              </div>
            ))
          )}

          {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex gap-3">
              <Avatar className="size-8 shrink-0">
                <AvatarFallback className="bg-primary text-primary-foreground">
                  <Bot className="size-4" />
                </AvatarFallback>
              </Avatar>
              <div className="rounded-lg px-3 py-2 bg-muted">
                <Loader2 className="size-4 animate-spin" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isSupabaseMode ? 'Escribe tu mensaje o pega contexto...' : 'Escribe tu mensaje...'}
            disabled={isLoading}
            className="flex-1"
          />
          <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </form>
    </Card>
  )
}
