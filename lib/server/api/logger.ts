type LogLevel = 'info' | 'warn' | 'error'

type LogValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | LogValue[]
  | { [key: string]: LogValue }

export type LogContext = Record<string, LogValue>

const REDACTED = '[redacted]'
const SENSITIVE_KEY_PATTERN = /secret|password|token|authorization|cookie|signature|key|credential/i

function sanitizeValue(key: string, value: LogValue): LogValue {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(key, item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childKey, childValue),
      ])
    )
  }

  if (typeof value === 'string' && value.length > 500) {
    return `${value.slice(0, 500)}...`
  }

  return value
}

export function sanitizeLogContext(context: LogContext = {}): LogContext {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, sanitizeValue(key, value)])
  )
}

function write(level: LogLevel, event: string, context: LogContext = {}) {
  if (process.env.NOON_LOG_SILENT === 'true') return

  const payload = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...sanitizeLogContext(context),
  }

  const serialized = JSON.stringify(payload)
  if (level === 'error') {
    console.error(serialized)
    return
  }
  if (level === 'warn') {
    console.warn(serialized)
    return
  }
  console.info(serialized)
}

export const logger = {
  info: (event: string, context?: LogContext) => write('info', event, context),
  warn: (event: string, context?: LogContext) => write('warn', event, context),
  error: (event: string, context?: LogContext) => write('error', event, context),
}

export function errorToLogContext(error: unknown): LogContext {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    }
  }

  return {
    errorMessage: String(error),
  }
}
