import { v0, type ChatDetail } from 'v0-sdk'

function isChatDetail(chat: Awaited<ReturnType<typeof v0.chats.create>>): chat is ChatDetail {
  return Boolean(chat && typeof chat === 'object' && 'webUrl' in chat)
}

export async function generateV0Prototype(prompt: string): Promise<{
  content: string
  demoUrl: string | null
  chatUrl: string
}> {
  if (!process.env.V0_API_KEY) {
    throw new Error('V0_API_KEY is not configured')
  }

  const chat = await v0.chats.create({
    message: prompt,
    system: 'Eres un experto en React y Tailwind CSS. Genera componentes modernos, limpios y funcionales.',
    chatPrivacy: 'private',
    responseMode: 'sync',
  })

  if (!isChatDetail(chat)) {
    throw new Error('v0 returned a streaming response when a synchronous chat response was expected.')
  }

  const demoUrl = chat.latestVersion?.demoUrl ?? null
  const chatUrl = chat.webUrl ?? ''

  // Get the generated code from the latest version
  const files = chat.latestVersion?.files ?? []
  const mainFile = files.find((file) => file.name.endsWith('.tsx') || file.name.endsWith('.jsx')) ?? files[0]
  const content = mainFile?.content ?? `Demo disponible en: ${demoUrl ?? chatUrl}`

  return { content, demoUrl, chatUrl }
}
