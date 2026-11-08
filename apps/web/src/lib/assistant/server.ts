import { eq, postgres_db, schema } from '@rpi-control-center/db-drizzle'
import { createServerFn } from '@tanstack/react-start'

import { complete, readModelConfig } from '~/lib/ai/model'
import { getOwnedDevice } from '~/lib/pi/devices'
import { requireSignedInUser } from '~/lib/utils/supabase/server'

/*
 * Server only: the assistant in the header. It answers with whatever
 * `appContext` tells it about the app, so give it the facts it needs there.
 */

const MAX_QUESTION = 1000
const MAX_TURNS = 8
const MAX_TURN = 3000

const requireUser = () => requireSignedInUser('Sign in to ask the assistant')

// ---------------------------------------------------------------------------
// Status

export interface AssistantStatus {
  enabled: boolean
  model: string | null
}

export const getAssistantStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AssistantStatus> => {
    await requireUser()
    const config = readModelConfig()
    return { enabled: Boolean(config), model: config?.model ?? null }
  },
)

// ---------------------------------------------------------------------------
// What the model is told

/**
 * Facts about the app and the signed-in user that the model should answer
 * with, one per line. Read them from the database here as the app grows.
 */
async function appContext(user: { id: string; email?: string | null }): Promise<string[]> {
  const devices = await postgres_db
    .select({
      name: schema.devices.name,
      host: schema.devices.host,
      username: schema.devices.username,
      remote_path: schema.devices.remote_path,
    })
    .from(schema.devices)
    .where(eq(schema.devices.owner_id, user.id))
  return [
    `The user is signed in as ${user.email ?? 'an unknown email'}.`,
    'The app is a control center for Raspberry Pis, reached over SSH. On a device page the user can Deploy (upload the raspberry-pi-script/ folder from the repo, run npm install, start `npm run start` in the background), Start, Stop and Restart the script, follow its output live, read temperature, memory, load and uptime, switch GPIO pins with pinctrl, open a terminal (an interactive SSH login shell on the Pi, on the Terminal tab), and see past deploys.',
    devices.length
      ? `The user's devices: ${devices.map((d) => `"${d.name}" (${d.username}@${d.host}, deploys to ~/${d.remote_path})`).join('; ')}.`
      : 'The user has not added a device yet; the Add device button on the Devices page does that.',
  ]
}

const SYSTEM_PROMPT = [
  'You are the assistant inside a Raspberry Pi control center web app. Answer the user clearly and briefly, in plain sentences.',
  'Use numbered steps for anything that takes more than one step, and fenced code blocks for code.',
  'If you do not know something about the app, say so rather than guess.',
].join(' ')

export interface AssistantTurn {
  role: 'user' | 'assistant'
  text: string
}

export type AssistantPart =
  | { kind: 'text'; text: string }
  | { kind: 'code'; lang: string; text: string }

export interface AssistantReply {
  /** The reply as the model wrote it; sent back as history with the next question. */
  raw: string
  parts: AssistantPart[]
  model: string
}

/** Prose around fenced code blocks. */
function splitReply(raw: string): AssistantPart[] {
  const parts: AssistantPart[] = []
  const fence = /```([\w-]*)[^\n]*\n([\s\S]*?)```/g
  let last = 0
  const pushText = (text: string) => {
    const trimmed = text.trim()
    if (trimmed) parts.push({ kind: 'text', text: trimmed })
  }
  for (const match of raw.matchAll(fence)) {
    pushText(raw.slice(last, match.index))
    last = (match.index ?? 0) + match[0].length
    parts.push({ kind: 'code', lang: match[1].toLowerCase(), text: match[2].replace(/\s+$/, '') })
  }
  pushText(raw.slice(last))
  return parts
}

function cleanTurns(turns: AssistantTurn[] | undefined): AssistantTurn[] {
  if (!Array.isArray(turns)) return []
  return turns
    .filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, text: t.text.trim().slice(0, MAX_TURN) }))
    .filter((t) => t.text)
}

export const askAssistant = createServerFn({ method: 'POST' })
  .inputValidator((input: { question: string; history?: AssistantTurn[] }) => input)
  .handler(async ({ data }): Promise<AssistantReply> => {
    const user = await requireUser()
    const config = readModelConfig()
    if (!config) throw new Error('No model is configured. Set AI_PROVIDER and AI_API_KEY.')
    const question = (typeof data.question === 'string' ? data.question : '')
      .trim()
      .slice(0, MAX_QUESTION)
    if (!question) throw new Error('Ask something first')
    const history = cleanTurns(data.history)
    const context = await appContext(user)
    const prompt = [
      'About the app:',
      ...context,
      '',
      ...(history.length
        ? [
            'The conversation so far:',
            ...history.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`),
            '',
          ]
        : []),
      `User: ${question}`,
      'Assistant:',
    ].join('\n')
    const raw = (
      await complete(config, {
        system: SYSTEM_PROMPT,
        user: prompt,
        temperature: 0.3,
        maxTokens: 900,
        timeoutMs: 90_000,
      })
    )
      .replace(/^Assistant:\s*/, '')
      .trim()
    return { raw, parts: splitReply(raw), model: config.model }
  })

// ---------------------------------------------------------------------------
// Explaining a system log entry

const MAX_MESSAGE = 2000
const MAX_EARLIER = 8

const PRIORITY_NAMES = [
  'emergency',
  'alert',
  'critical',
  'error',
  'warning',
  'notice',
  'info',
  'debug',
]

export interface LogEntryToExplain {
  /** Milliseconds since the epoch. */
  time: number | null
  priority: number | null
  /** `sshd[812]`, or empty. */
  program: string
  message: string
  /** How many identical entries in a row this one stands for. */
  count: number
}

function describeEntry(entry: LogEntryToExplain): string {
  const time = typeof entry.time === 'number' ? new Date(entry.time).toISOString() : 'unknown time'
  const priority =
    typeof entry.priority === 'number' ? (PRIORITY_NAMES[entry.priority] ?? 'unknown') : 'unknown'
  const program = String(entry.program ?? '').slice(0, 100) || 'unknown program'
  const message = String(entry.message ?? '').slice(0, MAX_MESSAGE)
  const repeated = entry.count > 1 ? ` (repeated ${Math.round(entry.count)} times)` : ''
  return `${time} [${priority}] ${program}: ${message}${repeated}`
}

const EXPLAIN_PROMPT = [
  "You explain entries from a Raspberry Pi's system journal to its owner, who may not know Linux well.",
  'In two to four short sentences: what happened in plain words, whether it needs attention, and if so what to do about it.',
  'Do not repeat the entry. If it is too vague to tell, say so rather than guess.',
].join(' ')

/** Asks the model what a journal entry on one of the user's devices means. */
export const explainLogEntry = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: { deviceId: string; entry: LogEntryToExplain; earlier?: LogEntryToExplain[] }) => ({
      deviceId: String(input.deviceId),
      entry: input.entry,
      earlier: Array.isArray(input.earlier) ? input.earlier.slice(-MAX_EARLIER) : [],
    }),
  )
  .handler(async ({ data }): Promise<string> => {
    const user = await requireUser()
    const config = readModelConfig()
    if (!config) throw new Error('No model is configured. Set AI_PROVIDER and AI_API_KEY.')
    const device = await getOwnedDevice(data.deviceId, user.id)
    const prompt = [
      `The Pi is called "${device.name}". Its owner manages it from a web control center that logs in over SSH as "${device.username}", so SSH logins by ${device.username} are usually the control center itself.`,
      '',
      'The entry to explain:',
      describeEntry(data.entry),
      ...(data.earlier.length
        ? ['', 'The entries just before it, oldest first:', ...data.earlier.map(describeEntry)]
        : []),
    ].join('\n')
    return (
      await complete(config, {
        system: EXPLAIN_PROMPT,
        user: prompt,
        temperature: 0.2,
        maxTokens: 400,
        timeoutMs: 60_000,
      })
    ).trim()
  })
