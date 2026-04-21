'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Users, FolderKanban, CheckSquare } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

interface SearchResults {
  leads: Array<{ id: string; name: string; email: string; company: string | null; status: string }>
  projects: Array<{ id: string; name: string; status: string }>
  tasks: Array<{ id: string; title: string; status: string; project_id: string }>
}

const empty: SearchResults = { leads: [], projects: [], tasks: [] }

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>(empty)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const { authMode } = useAuth()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults(empty)
      return
    }
    if (query.length < 2 || authMode !== 'supabase') {
      setResults(empty)
      return
    }

    const timer = setTimeout(async () => {
      setIsLoading(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        const json = await res.json()
        if (json.data) setResults(json.data)
      } catch {
        // ignore
      } finally {
        setIsLoading(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query, open, authMode])

  const select = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  const hasResults =
    results.leads.length > 0 || results.projects.length > 0 || results.tasks.length > 0

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Buscar leads, proyectos, tareas…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {query.length >= 2 && !isLoading && !hasResults && (
          <CommandEmpty>Sin resultados para &ldquo;{query}&rdquo;</CommandEmpty>
        )}
        {query.length < 2 && (
          <CommandEmpty className="text-xs text-muted-foreground py-6">
            Escribe al menos 2 caracteres para buscar
          </CommandEmpty>
        )}

        {results.leads.length > 0 && (
          <CommandGroup heading="Leads">
            {results.leads.map((lead) => (
              <CommandItem
                key={lead.id}
                value={`lead-${lead.id}-${lead.name}`}
                onSelect={() => select(`/dashboard/leads?leadId=${lead.id}`)}
              >
                <Users className="mr-2 size-4 text-muted-foreground" />
                <span>{lead.name}</span>
                {lead.company && (
                  <span className="ml-2 text-xs text-muted-foreground">{lead.company}</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results.projects.length > 0 && (
          <CommandGroup heading="Proyectos">
            {results.projects.map((project) => (
              <CommandItem
                key={project.id}
                value={`project-${project.id}-${project.name}`}
                onSelect={() => select(`/dashboard/projects?projectId=${project.id}`)}
              >
                <FolderKanban className="mr-2 size-4 text-muted-foreground" />
                <span>{project.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results.tasks.length > 0 && (
          <CommandGroup heading="Tareas">
            {results.tasks.map((task) => (
              <CommandItem
                key={task.id}
                value={`task-${task.id}-${task.title}`}
                onSelect={() => select(`/dashboard/tasks?taskId=${task.id}`)}
              >
                <CheckSquare className="mr-2 size-4 text-muted-foreground" />
                <span>{task.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
