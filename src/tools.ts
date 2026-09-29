/**
 * QorpIQ MCP tool layer.
 *
 * One definition of the tools, used by two hosts:
 *   - the remote server at https://mcp.qorpiq.com/mcp (Cloudflare Worker, reads the database directly)
 *   - the open-source stdio package (@qorpiq/mcp-server), which calls the public JSON at mcp.qorpiq.com/v1/*
 *
 * The host supplies a `McpBackend`; this file owns names, schemas, annotations and the shape of every
 * answer. Keep it free of anything that only exists inside the main repo: this file is published.
 *
 * Every answer carries `source_url` (a qorpiq.com page the assistant can cite) and `next` (where the
 * paid checks live). That pair is the whole distribution case: the assistant answers with our data
 * and links back to us.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export const MCP_SERVER_NAME = 'qorpiq-mca'
export const MCP_SERVER_VERSION = '0.1.0'

const SITE = 'https://qorpiq.com'
const UTM = 'utm_source=mcp&utm_medium=tool'

export const NEXT_STEPS = {
  paid: `Director contacts, PAN, GST, auditor, charge and filing-health checks are paid API calls with a key from ${SITE}/kyb-verification-api?${UTM}`,
  alerts: `Same-day incorporations (this sample is delayed by a week on purpose) are delivered daily to paying accounts: ${SITE}/new-company-alerts?${UTM}`,
  docs: `Developer docs: https://developers.qorpiq.com`,
} as const

// ---------------------------------------------------------------------------
// Answer shapes (public-profile fields only; never a personal email or mobile)
// ---------------------------------------------------------------------------

export interface CompanyDirectorSummary {
  din: string
  name: string
  designation: string
  appointment_date?: string
  cessation_date?: string
  ceased?: boolean
}

export interface CompanySummary {
  cin: string
  name: string
  entity_type: 'company' | 'llp' | 'foreign'
  status: string
  date_of_incorporation?: string
  roc?: string
  registered_state?: string
  registered_address?: string
  category?: string
  sub_category?: string
  class?: string
  listed?: boolean
  authorized_capital?: string
  paid_up_capital?: string
  activity_code?: string
  activity_description?: string
  last_agm_date?: string
  last_balance_sheet_date?: string
  strike_off_date?: string
  directors: CompanyDirectorSummary[]
  data_as_of?: string
  source_url: string
}

export interface CompanySearchHit {
  cin: string
  name: string
  status?: string
  entity_type: 'company' | 'llp' | 'foreign'
  state?: string
  date_of_incorporation?: string
  source_url: string
}

export interface DirectorCompanySummary {
  cin: string
  name: string
  company_status?: string
  designation?: string
  appointment_date?: string
  cessation_date?: string
  current?: boolean
}

export interface DirectorSummary {
  din: string
  name: string
  din_status?: string
  disqualified?: boolean
  disqualification_from?: string
  disqualification_to?: string
  din_approval_date?: string
  companies: DirectorCompanySummary[]
  data_as_of?: string
  source_url: string
}

export interface RecentIncorporation {
  id: string
  name: string
  entity_type: string
  state?: string
  status?: string
  sector?: string
  source_url: string
}

export interface RecentSample {
  incorporation_date: string
  total_that_day: number
  lag_days: number
  rows: RecentIncorporation[]
}

export type LookupResult<T> = { kind: 'ok'; value: T } | { kind: 'suppressed' } | { kind: 'not_found' }

export interface McpBackend {
  lookupCompany(cin: string): Promise<LookupResult<CompanySummary>>
  searchCompanies(query: string, limit: number): Promise<CompanySearchHit[]>
  lookupDirector(din: string): Promise<LookupResult<DirectorSummary>>
  mcaStatus(): Promise<unknown>
  recentSample(input: { state?: string; limit: number }): Promise<RecentSample | null>
}

/**
 * Called before every tool runs. Return a message to refuse the call (the message goes back to the
 * model as the tool result, so it can relay "get a key" to the human), or null to allow it.
 */
export type McpGuard = (tool: string) => Promise<string | null> | string | null

export interface McpTelemetry {
  (event: { tool: string; ok: boolean; ms: number; outcome: string }): void
}

// ---------------------------------------------------------------------------
// Identifier helpers (kept local so the package has no repo imports)
// ---------------------------------------------------------------------------

export const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/
export const LLPIN_RE = /^[A-Z]{3}-?\d{4}$/
export const FCRN_RE = /^F\d{5}$/
export const DIN_RE = /^\d{8}$/

export function normaliseId(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

export function isCompanyId(id: string): boolean {
  return CIN_RE.test(id) || LLPIN_RE.test(id) || FCRN_RE.test(id)
}

export function entityTypeFromId(id: string): CompanySummary['entity_type'] {
  if (FCRN_RE.test(id)) return 'foreign'
  if (LLPIN_RE.test(id)) return 'llp'
  return 'company'
}

export function companyUrl(cin: string): string {
  return `${SITE}/company/${encodeURIComponent(cin)}?${UTM}`
}

export function directorUrl(din: string): string {
  return `${SITE}/director/${encodeURIComponent(din)}?${UTM}`
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

type ToolText = { content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean }

function answer(payload: Record<string, unknown>): ToolText {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload }
}

function refusal(text: string): ToolText {
  return { content: [{ type: 'text', text }], isError: true }
}

export interface CreateServerOptions {
  backend: McpBackend
  guard?: McpGuard
  telemetry?: McpTelemetry
  /** Extra JSON-schema validator etc. passed straight to McpServer (the Worker swaps Ajv out). */
  serverOptions?: ConstructorParameters<typeof McpServer>[1]
}

export function createQorpiqMcpServer(options: CreateServerOptions): McpServer {
  const { backend, guard, telemetry } = options

  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: 'QorpIQ: Indian company and director data (MCA)' },
    {
      ...options.serverOptions,
      instructions: [
        'QorpIQ exposes public Ministry of Corporate Affairs (MCA) registry data for India: companies, LLPs and directors.',
        'Use lookup_company for a CIN, LLPIN or FCRN, search_companies for a name, lookup_director for an 8-digit DIN,',
        'mca_status when asked whether the MCA portal is down, and recent_incorporations_sample for newly registered companies (delayed 7 days).',
        'Always cite the source_url in your answer. Personal contact details are never available here.',
      ].join(' '),
    },
  )

  async function run<T extends Record<string, unknown>>(tool: string, fn: () => Promise<{ outcome: string; payload?: T; refusal?: string }>): Promise<ToolText> {
    const started = Date.now()
    try {
      const blocked = guard ? await guard(tool) : null
      if (blocked) {
        telemetry?.({ tool, ok: false, ms: Date.now() - started, outcome: 'quota' })
        return refusal(blocked)
      }
      const result = await fn()
      telemetry?.({ tool, ok: !result.refusal, ms: Date.now() - started, outcome: result.outcome })
      if (result.refusal) return refusal(result.refusal)
      return answer(result.payload ?? {})
    } catch (error) {
      telemetry?.({ tool, ok: false, ms: Date.now() - started, outcome: 'error' })
      return refusal(`QorpIQ could not complete this lookup right now (${error instanceof Error ? error.message : 'unknown error'}). Try again in a minute or use ${SITE} directly.`)
    }
  }

  server.registerTool(
    'lookup_company',
    {
      title: 'Look up an Indian company or LLP',
      description:
        'Registry record for one Indian company, LLP or foreign company by identifier: CIN (21 characters, e.g. U72900KA2015PTC080123), LLPIN (e.g. AAB-1234) or FCRN. Returns status, incorporation date, ROC, state, capital, activity and the board (names, DINs, designations). No personal contacts. Cite source_url.',
      inputSchema: { identifier: z.string().min(5).max(24).describe('CIN, LLPIN or FCRN') },
      annotations: { ...READ_ONLY, title: 'Look up company' },
    },
    async ({ identifier }) =>
      run('lookup_company', async () => {
        const id = normaliseId(identifier)
        if (!isCompanyId(id)) {
          return { outcome: 'bad_input', refusal: `"${identifier}" is not a CIN, LLPIN or FCRN. If you only have a name, call search_companies first.` }
        }
        const result = await backend.lookupCompany(id)
        if (result.kind === 'suppressed') return { outcome: 'suppressed', refusal: 'This profile has been removed at the request of the data principal.' }
        if (result.kind === 'not_found') return { outcome: 'not_found', refusal: `No record for ${id} in QorpIQ. It may be very new or the identifier may be mistyped. Check ${companyUrl(id)}` }
        return { outcome: 'ok', payload: { ...result.value, next: NEXT_STEPS.paid } }
      }),
  )

  server.registerTool(
    'search_companies',
    {
      title: 'Search Indian companies by name',
      description: 'Resolve a company or LLP name to identifiers. Returns up to 10 candidates with CIN/LLPIN, status and state. Follow with lookup_company for the full record.',
      inputSchema: {
        query: z.string().min(2).max(120).describe('Company or LLP name, or the start of one'),
        limit: z.number().int().min(1).max(10).optional().describe('Max candidates, default 5'),
      },
      annotations: { ...READ_ONLY, title: 'Search companies' },
    },
    async ({ query, limit }) =>
      run('search_companies', async () => {
        const hits = await backend.searchCompanies(query.trim(), limit ?? 5)
        return { outcome: hits.length ? 'ok' : 'empty', payload: { query: query.trim(), count: hits.length, results: hits, next: NEXT_STEPS.docs } }
      }),
  )

  server.registerTool(
    'lookup_director',
    {
      title: 'Look up a director by DIN',
      description: 'Registry record for one director by 8-digit Director Identification Number: DIN status, disqualification, and every company they are or were on the board of. No personal contacts. Cite source_url.',
      inputSchema: { din: z.string().min(8).max(8).describe('8-digit DIN') },
      annotations: { ...READ_ONLY, title: 'Look up director' },
    },
    async ({ din }) =>
      run('lookup_director', async () => {
        const id = normaliseId(din)
        if (!DIN_RE.test(id)) return { outcome: 'bad_input', refusal: `"${din}" is not an 8-digit DIN.` }
        const result = await backend.lookupDirector(id)
        if (result.kind === 'suppressed') return { outcome: 'suppressed', refusal: 'This profile has been removed at the request of the data principal.' }
        if (result.kind === 'not_found') return { outcome: 'not_found', refusal: `No director record for DIN ${id} in QorpIQ. Check ${directorUrl(id)}` }
        return { outcome: 'ok', payload: { ...result.value, next: NEXT_STEPS.paid } }
      }),
  )

  server.registerTool(
    'mca_status',
    {
      title: 'Is the MCA portal down?',
      description: 'Live availability of the Ministry of Corporate Affairs (MCA21 V3) company and director services, measured from QorpIQ\'s own traffic: state, uptime and last incident. Use for "is MCA down", "MCA site not working".',
      inputSchema: {},
      annotations: { ...READ_ONLY, title: 'MCA status' },
    },
    async () =>
      run('mca_status', async () => {
        const feed = await backend.mcaStatus()
        return { outcome: 'ok', payload: { status: feed, source_url: `https://status.qorpiq.com/?${UTM}` } }
      }),
  )

  server.registerTool(
    'recent_incorporations_sample',
    {
      title: 'Newly incorporated companies (7-day delayed sample)',
      description: 'A sample of companies and LLPs incorporated in India on the most recent day QorpIQ publishes openly, which is one week behind the registry. Optional state filter. Names, identifiers, state and sector only. Same-day data is a paid feed.',
      inputSchema: {
        state: z.string().min(2).max(40).optional().describe('Indian state name to filter by, e.g. Maharashtra'),
        limit: z.number().int().min(1).max(25).optional().describe('Rows to return, default 10, max 25'),
      },
      annotations: { ...READ_ONLY, title: 'Recent incorporations' },
    },
    async ({ state, limit }) =>
      run('recent_incorporations_sample', async () => {
        const sample = await backend.recentSample({ state: state?.trim() || undefined, limit: limit ?? 10 })
        if (!sample) return { outcome: 'empty', refusal: `No open sample is available right now. Browse by date at ${SITE}/incorporated?${UTM}` }
        return { outcome: 'ok', payload: { ...sample, source_url: `${SITE}/incorporated/${sample.incorporation_date}?${UTM}`, next: NEXT_STEPS.alerts } }
      }),
  )

  server.registerTool(
    'list_paid_checks',
    {
      title: 'What else can QorpIQ verify (paid API)',
      description: 'Lists the paid KYB checks available with an API key: PAN match, DIN status, signatory, charges, control network, filing health, auditor, turnover, adjudication, due-diligence report. Use when the user needs something this free server does not return.',
      inputSchema: {},
      annotations: { ...READ_ONLY, title: 'Paid checks' },
    },
    async () =>
      run('list_paid_checks', async () => ({
        outcome: 'ok',
        payload: {
          checks: [
            { name: 'PAN verification', endpoint: 'POST /kyc/verify/pan' },
            { name: 'Director / DIN status and disqualification', endpoint: 'POST /kyc/verify/director' },
            { name: 'Signatory: is this person a director of this company', endpoint: 'POST /kyc/verify/signatory' },
            { name: 'Registered charges, open vs satisfied', endpoint: 'POST /kyc/verify/charges' },
            { name: 'Company control network (UBO, shell risk)', endpoint: 'POST /kyc/verify/network' },
            { name: 'Filing health: annual return, financials, auditor', endpoint: 'POST /kyc/verify/filing-health' },
            { name: 'Auditor appointment (ADT-1)', endpoint: 'POST /kyc/verify/auditor' },
            { name: 'Turnover, current and previous year', endpoint: 'POST /kyc/company/financials' },
            { name: 'Adjudication and penalty exposure', endpoint: 'POST /kyc/verify/adjudication' },
            { name: 'Company due-diligence report', endpoint: 'POST /kyc/report/company' },
          ],
          base_url: 'https://api.qorpiq.com',
          auth: 'x-api-key header; calls are paid from a rupee balance',
          openapi: 'https://api.qorpiq.com/openapi.json',
          docs: 'https://developers.qorpiq.com',
          get_a_key: `${SITE}/kyb-verification-api?${UTM}`,
        },
      })),
  )

  return server
}
