export type CursorPayload = {
  createdAt: string
  id: string
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url')
}

export function decodeCursor(token: string): CursorPayload | null {
  try {
    if (!token) return null
    const json = Buffer.from(token, 'base64url').toString('utf-8')
    const parsed = JSON.parse(json)
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      return null
    }
    return { createdAt: parsed.createdAt, id: parsed.id }
  } catch {
    return null
  }
}
