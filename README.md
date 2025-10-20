# Product Studio Team (Plain-English Guide)

Build new product ideas with an AI "studio" that works like a small team. You chat in everyday language; the team moves through clear steps and asks for your approval before continuing.

What you get
- A quick viability check with sources
- One simple visual mockup to align on a direction
- A short product spec and bill of materials (BOM)
- A first list of ingredients and manufacturer leads

How it works (Agno under the hood)
- Agent teammates: We built four specialists with Agno and put them in one Team.
  - ResearchAgent: checks the market and competition with web citations.
  - VisualAgent: proposes one mockup and shares a real image link.
  - ProductAgent: turns the idea into a short, buildable spec.
  - SourcingAgent: drafts ingredients and a shortlist of makers.
- One coordinator: A friendly Coordinator keeps everyone on track and only moves forward when you say it’s OK (simple "looks good, continue" is enough).
- Simple stages: intake → viability → visuals → spec → sourcing → final. You can say "revise visuals" or "go back to spec" at any time.
- Memory: The team remembers choices and approvals using a tiny SQLite file, so your session survives refreshes.
- Tools: Research uses Perplexity’s Search API for grounded sources. Visuals use Replicate to generate a real image URL. We add small helper tools to save your choices (e.g., selected visual, spec snapshot).

Quick start
- Requirements: Python 3.11+, Node 18+, and a browser
- Keys you’ll need (place in a `.env` at the repo root):
  - `OPENROUTER_API_KEY` (required) – lets the agents think and write clearly.
  - `PERPLEXITY_API_KEY` (required) – powers web search for up-to-date sources.
  - `REPLICATE_API_TOKEN` (optional) – enables image generation for mockups.

Start the backend (AgentOS)
- cd `backend`
- `pip install agno fastapi[standard] uvicorn httpx replicate`
- `python agentos_app.py`
- The AgentOS FastAPI server runs at `http://localhost:7777`

Start the frontend (Next.js)
- cd `frontend`
- `npm install`
- `npm run dev`
- Open `http://localhost:3000`
- If your backend isn’t on the default URL, set `NEXT_PUBLIC_AGENTOS_URL` in `frontend/.env.local` (for example `http://localhost:7777`).

Try it
- "I want to make a calming lavender soap for Gen Z."
- "Approve viability" or "revise viability: check competitors in EU."
- "Show one playful mockup."
- "Approve visuals; write the v1 spec."

What Agno is doing for you
- Agents: Each teammate is an Agno `Agent`. We group them into an Agno `Team` with one coordinator. The Team handles delegation and keeps everyone’s replies visible.
- Shared state: We enable shared session state so the coordinator can enforce stage gates and remember approvals. The data is stored in `backend/team/data/product_studio.db`.
- Tools with guardrails:
  - `perplexity_search`: a web search tool that the research and sourcing agents use for fresh sources (we nudge them and also double-check they used it).
  - `generate_media`: creates one mockup image via Replicate so you get a real URL and inline preview.
  - Small helper tools like `set_stage`, `mark_approval`, `record_visual_choice`, and `record_spec` to save decisions as you go.
- AgentOS app: We wrap the Team in Agno’s AgentOS, which exposes a lightweight FastAPI service. The frontend streams updates from `http://localhost:7777` so you see responses live.

Approvals are casual
- You can type "yeah, looks good, continue" or "go ahead" to advance.
- If you’re unsure, say "revise visuals" or ask questions—the coordinator will loop the right teammate back in.

Troubleshooting
- Frontend can’t connect: make sure the backend is running on `http://localhost:7777` or update `NEXT_PUBLIC_AGENTOS_URL`.
- No web sources: set `PERPLEXITY_API_KEY` in `.env`.
- Image not showing: set `REPLICATE_API_TOKEN` in `.env` (or skip images and continue).
- Model issues: confirm `OPENROUTER_API_KEY` is valid and has quota.

Want more detail?
- See the fuller plan and roles in `backend/docs/TEAM_PLAN.md`.
- The team code lives in `backend/team/innovation_team.py` if you’re curious.
