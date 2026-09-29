/**
 * Backend for the stdio package: every tool call becomes one GET to the public JSON on
 * mcp.qorpiq.com/v1/*. Same shapes, same daily quota as the remote server.
 */
import type {
  CompanySearchHit,
  CompanySummary,
  DirectorSummary,
  LookupResult,
  McpBackend,
  RecentSample,
} from './tools.js'

export const DEFAULT_BASE_URL = 'https://mcp.qorpiq.com'

export function createHttpBackend(baseUrl: string = DEFAULT_BASE_URL, fetchImpl: typeof fetch = fetch): McpBackend {
  const base = baseUrl.replace(/\/$/, '')
  const headers = { accept: 'application/json', 'user-agent': 'qorpiq-mcp-stdio/0.1.0' }

  async function get<T>(path: string): Promise<{ status: number; body: T | { error?: string } }> {
    const response = await fetchImpl(`${base}${path}`, { headers })
    const body = (await response.json().catch(() => ({}))) as T | { error?: string }
    return { status: response.status, body }
  }

  function toLookup<T>(result: { status: number; body: T | { error?: string } }): LookupResult<T> {
    if (result.status === 410) return { kind: 'suppressed' }
    if (result.status === 404) return { kind: 'not_found' }
    if (result.status === 429) throw new Error((result.body as { error?: string }).error || 'daily quota reached')
    if (result.status >= 400) throw new Error((result.body as { error?: string }).error || `HTTP ${result.status}`)
    return { kind: 'ok', value: result.body as T }
  }

  return {
    async lookupCompany(cin) {
      return toLookup(await get<CompanySummary>(`/v1/company/${encodeURIComponent(cin)}`))
    },
    async searchCompanies(query, limit) {
      const result = await get<{ results: CompanySearchHit[] }>(`/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`)
      if (result.status >= 400) throw new Error((result.body as { error?: string }).error || `HTTP ${result.status}`)
      return (result.body as { results: CompanySearchHit[] }).results ?? []
    },
    async lookupDirector(din) {
      return toLookup(await get<DirectorSummary>(`/v1/director/${encodeURIComponent(din)}`))
    },
    async mcaStatus() {
      const result = await get<unknown>('/v1/status')
      if (result.status >= 400) throw new Error(`HTTP ${result.status}`)
      return result.body
    },
    async recentSample({ state, limit }) {
      const params = new URLSearchParams({ limit: String(limit) })
      if (state) params.set('state', state)
      const result = await get<RecentSample>(`/v1/recent?${params.toString()}`)
      if (result.status === 404) return null
      if (result.status >= 400) throw new Error((result.body as { error?: string }).error || `HTTP ${result.status}`)
      return result.body as RecentSample
    },
  }
}
