export type LeadFollowUpState = 'scheduled' | 'due_today' | 'overdue'

export function getLeadFollowUpState(nextFollowUpAt?: Date, now = new Date()): LeadFollowUpState | null {
  if (!nextFollowUpAt) {
    return null
  }

  if (nextFollowUpAt.getTime() < now.getTime()) {
    return 'overdue'
  }

  if (isSameLocalDay(nextFollowUpAt, now)) {
    return 'due_today'
  }

  return 'scheduled'
}

export function formatLeadFollowUpDateTime(date: Date, locale = 'es-MX'): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function toDateTimeLocalValue(date?: Date): string {
  if (!date) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

export function parseDateTimeLocalValue(value: string): Date | null {
  if (!value) {
    return null
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}
