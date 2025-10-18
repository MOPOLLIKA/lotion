# Product Studio Team

This package holds the single-team, stage-gated product studio described in `docs/TEAM_PLAN.md`. One coordinator runs the full pipeline end-to-end; there are no subteams or workflows.

## Team Members
- **CoordinatorPM** (team leader instructions) – manages stages, handles approvals in casual language, and uses helper tools (`set_stage`, `set_awaiting`, `mark_approval`, `record_brief`, `record_visual_choice`) to keep session state aligned with the conversation.
- **ResearchAgent** – checks viability using OpenRouter’s Grok-4 fast reasoning model; Coordinator explicitly reminds them to run `perplexity_search`, and a post-hook guarantees at least one call for grounded citations.
- **VisualAgent** – generates a single Replicate-powered mockup concept per request, sharing the raw URL and a markdown preview.
- **ProductAgent** – writes the v1 product spec, BOM, and open questions.
- **SourcingAgent** – finds ingredients and manufacturers using Grok-4 fast; Coordinator nudges them to run `perplexity_search`, and the same post-hook appends fresh findings automatically.

Approvals are conversational: phrases like “yeah, looks good, continue” are treated as green lights. Users can ask for tweaks with natural language (e.g. “hmm, can we adjust the packaging vibe?”) and the coordinator loops back before advancing the stage.

## Session State & Gates
The team stores session state with `add_session_state_to_context=True`, `enable_agentic_state=True`, and persists runs in a SQLite DB under `team/data/product_studio.db`. CoordinatorPM leans on this shared state to gate each stage, so stages progress `intake → viability → visuals → spec → sourcing → final` only after a casual approval is detected. See the JSON scaffold in `docs/TEAM_PLAN.md` for exact fields.

## Environment
Set these variables before running the team or the FastAPI app:

- `OPENROUTER_API_KEY` – required for all OpenRouter models and the coordinator. (We auto-populate `OPENAI_API_KEY` from this so you don't need a separate key.)
  Place this in the project-level `.env` (repo root); the team loader pulls in both the root and `team/.env` files automatically.
- `PERPLEXITY_API_KEY` – required for the Perplexity Search API tool used by ResearchAgent and SourcingAgent (`perplexity_search`). Optional `PERPLEXITY_TIMEOUT_MS` (milliseconds) overrides request timeout and `PERPLEXITY_SEARCH_URL` swaps the endpoint if needed.

Image generation runs through Replicate (`bytedance/seedream-4`); ensure `REPLICATE_API_TOKEN` is available before launching AgentOS.
