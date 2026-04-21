'use client'

import { useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Upload, FileText, AlertCircle, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

interface ParsedRow {
  name: string
  email: string
  phone?: string
  whatsapp?: string
  company?: string
  source: string
  value?: string
  notes?: string
}

const REQUIRED = ['name', 'email'] as const
const COLUMNS = ['name', 'email', 'phone', 'whatsapp', 'company', 'source', 'value', 'notes'] as const
const VALID_SOURCES = ['website', 'referral', 'cold_call', 'social', 'event', 'other']

function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))

  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''))
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = values[i] ?? '' })

    return {
      name: row.name ?? row.nombre ?? '',
      email: row.email ?? row.correo ?? '',
      phone: row.phone ?? row.telefono ?? undefined,
      whatsapp: row.whatsapp ?? undefined,
      company: row.company ?? row.empresa ?? undefined,
      source: VALID_SOURCES.includes(row.source ?? '') ? row.source : 'other',
      value: row.value ?? row.valor ?? undefined,
      notes: row.notes ?? row.notas ?? undefined,
    }
  }).filter((r) => r.name && r.email)
}

interface Props {
  onImported: () => void
}

export function LeadImportDialog({ onImported }: Props) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [imported, setImported] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setRows([])
    setFileName('')
    setImported(0)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const parsed = parseCSV(text)
      setRows(parsed)
    }
    reader.readAsText(file)
  }

  const handleImport = async () => {
    setIsImporting(true)
    let count = 0

    for (const row of rows) {
      try {
        const res = await fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: row.name,
            email: row.email,
            phone: row.phone || undefined,
            whatsapp: row.whatsapp || undefined,
            company: row.company || undefined,
            source: row.source,
            value: Number(row.value) || 0,
            notes: row.notes || undefined,
            tags: [],
            leadOrigin: 'outbound',
          }),
        })
        if (res.ok) count++
      } catch {
        // skip row on error
      }
    }

    setImported(count)
    setIsImporting(false)
    toast.success(`${count} de ${rows.length} leads importados`)
    onImported()
  }

  const validRows = rows.filter((r) => r.name && r.email.includes('@'))
  const invalidRows = rows.length - validRows.length

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Upload className="size-4" />
          Importar CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar leads desde CSV</DialogTitle>
          <DialogDescription>
            El archivo debe tener columnas: <code className="text-xs bg-muted px-1 rounded">name, email</code> (requeridas) + opcionales: phone, whatsapp, company, source, value, notes
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload area */}
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-muted/40 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFile}
            />
            {fileName ? (
              <div className="flex items-center justify-center gap-2 text-sm">
                <FileText className="size-5 text-primary" />
                <span className="font-medium">{fileName}</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Upload className="size-8" />
                <p className="text-sm">Haz clic para seleccionar un archivo CSV</p>
              </div>
            )}
          </div>

          {/* Preview */}
          {rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1 text-success">
                  <CheckCircle2 className="size-4" /> {validRows.length} válidos
                </span>
                {invalidRows > 0 && (
                  <span className="flex items-center gap-1 text-destructive">
                    <AlertCircle className="size-4" /> {invalidRows} con errores (se omitirán)
                  </span>
                )}
              </div>
              <div className="rounded-md border overflow-auto max-h-48">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {['Nombre', 'Email', 'Empresa', 'Fuente', 'Valor'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {validRows.slice(0, 10).map((row, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-1.5">{row.name}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{row.email}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{row.company ?? '—'}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{row.source}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{row.value ? `$${row.value}` : '—'}</td>
                      </tr>
                    ))}
                    {validRows.length > 10 && (
                      <tr className="border-t bg-muted/30">
                        <td colSpan={5} className="px-3 py-1.5 text-center text-muted-foreground">
                          +{validRows.length - 10} más…
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {imported > 0 && (
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="size-4" />
              {imported} leads importados correctamente
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button
            onClick={handleImport}
            disabled={validRows.length === 0 || isImporting}
            className="gap-2"
          >
            {isImporting ? <Spinner className="size-4" /> : <Upload className="size-4" />}
            {isImporting ? 'Importando…' : `Importar ${validRows.length} leads`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
