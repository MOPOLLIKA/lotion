# Lotion Product Innovation Studio

Full-stack workspace for the AgentOS-powered product innovation team. The backend exposes the multi-agent workflow over FastAPI, while the Next.js frontend provides the user experience for ideation, visual selection, and spec review.

---

## Prerequisites
- **Node.js 20+** (ships with `npx`, required for both the frontend and the Perplexity MCP tool)
- **npm 10+** (auto-installed with Node; feel free to use `pnpm` or `yarn` if you know how to adapt the commands)
- **Python 3.11+**
- **API keys**
  - `OPENROUTER_API_KEY` – used for Grok models and forwarded to `OPENAI_API_KEY`
  - `PERPLEXITY_API_KEY` – enables the Perplexity MCP server used by ResearchAgent and SourcingAgent

## Clone the Repository
```bash
git clone <repo-url>
cd lotion
```

---

## Environment Configuration
The backend automatically loads two optional dotenv files:
- `./.env` (repo root)
- `./backend/team/.env`

Create at least one of them with the required keys:
```env
OPENROUTER_API_KEY=sk-...
PERPLEXITY_API_KEY=px-...
# Optional:
# PERPLEXITY_TIMEOUT_MS=20000
```

### Frontend environment (optional)
The UI defaults to talking to `http://localhost:7777` with team id `productstudioteam`. Override by creating `frontend/.env.local`:
```env
NEXT_PUBLIC_AGENTOS_URL=http://localhost:7777
NEXT_PUBLIC_AGENTOS_TEAM_ID=productstudioteam
```

---

## Backend Setup (AgentOS + Team)
```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install --upgrade pip
pip install agno fastapi uvicorn
```

Start the AgentOS FastAPI server:
```bash
python agentos_app.py
```

This serves the team at `http://localhost:7777` and launches the Perplexity MCP tool through `npx @perplexity-ai/mcp-server` on demand.

---

## Frontend Setup (Next.js)
```bash
cd frontend
npm install
npm run dev
```

The frontend runs on `http://localhost:3000` and proxies requests to the AgentOS server.

---

## Local Development Workflow
1. **Start the backend** (`python agentos_app.py`) – required for all agent interactions.
2. **Start the frontend** (`npm run dev`) – provides the ideation UI.
3. Open `http://localhost:3000`, describe a product idea, approve visuals, and review the generated spec.

### Handy commands
- Restart backend quickly: `uvicorn agentos_app:app --reload` (only if MCP tooling allows reloading)
- Clear the SQLite session DB: `rm backend/team/data/product_studio.db`
- Lint the frontend: `npm run lint`

---

## Troubleshooting
- **MCP errors about Perplexity**: confirm `PERPLEXITY_API_KEY` is set and `npx` can reach the package (Node 20+ required).
- **Models fail to load**: ensure `OPENROUTER_API_KEY` is valid; it doubles as `OPENAI_API_KEY`.
- **Frontend cannot reach backend**: check the AgentOS server is listening on `http://localhost:7777` or update `NEXT_PUBLIC_AGENTOS_URL`.

Happy building!
