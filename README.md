# QorpIQ MCP server: Indian company and director data

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives ChatGPT, Claude, Cursor and any MCP client read access to India's corporate registry (Ministry of Corporate Affairs, MCA) through [QorpIQ](https://qorpiq.com/mcp).

- Company or LLP by **CIN, LLPIN or FCRN**: status, incorporation date, ROC, state, capital, activity, board with DINs
- Company **name search** to identifiers
- Director by **DIN**: status, disqualification, every directorship
- **Is MCA down?** Live portal status
- **Newly registered companies**, a sample delayed by one week
- Free. No account, no key. 100 tool calls a day per network address. Read-only. No personal contacts.

## Remote server (recommended)

```
https://mcp.qorpiq.com/mcp
```

Streamable HTTP, no authentication. Add it as a connector in ChatGPT (Developer Mode), Claude (custom connector) or in any `mcp.json`:

```json
{
  "mcpServers": {
    "qorpiq": { "url": "https://mcp.qorpiq.com/mcp" }
  }
}
```

## Stdio (this package)

For clients that only speak stdio. It calls the same public JSON at `mcp.qorpiq.com/v1/*`.

```json
{
  "mcpServers": {
    "qorpiq": {
      "command": "npx",
      "args": ["-y", "@qorpiq/mcp-server"]
    }
  }
}
```

## Tools

| Tool | Input | Returns |
|---|---|---|
| `lookup_company` | `identifier` (CIN, LLPIN, FCRN) | registry record + `source_url` |
| `search_companies` | `query`, `limit` (max 10) | candidates with CIN, status, state |
| `lookup_director` | `din` (8 digits) | DIN status, disqualification, companies |
| `mca_status` | none | MCA21 component states and uptime |
| `recent_incorporations_sample` | `state?`, `limit` (max 25) | one week-old day of incorporations |
| `list_paid_checks` | none | the paid KYB checks and how to get a key |

Every answer includes a `source_url` on qorpiq.com you can cite, and a `next` line describing what the paid API adds.

## Plain HTTP

The same data without MCP:

```
GET https://mcp.qorpiq.com/v1/company/{cin}
GET https://mcp.qorpiq.com/v1/search?q={name}&limit=5
GET https://mcp.qorpiq.com/v1/director/{din}
GET https://mcp.qorpiq.com/v1/recent?state=Maharashtra&limit=10
GET https://mcp.qorpiq.com/v1/status
```

## What it will not return

Personal emails or mobile numbers, same-day incorporations, or any profile a data principal has had removed under India's DPDP Act. Those limits are by design. Paid verification checks (PAN, GST, charges, filing health, auditor, turnover, adjudication, due-diligence report) are on the REST API at [developers.qorpiq.com](https://developers.qorpiq.com).

## Develop

```
npm install
npm run dev              # stdio against the production endpoints
QORPIQ_MCP_BASE_URL=http://localhost:8787 npm run dev
```

MIT licensed. Data terms: [qorpiq.com/terms](https://qorpiq.com/terms).
