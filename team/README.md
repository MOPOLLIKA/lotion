# Product Studio Team

This package holds the single-team, stage-gated product studio described in `docs/TEAM_PLAN.md`. One coordinator runs the full pipeline end-to-end; there are no subteams or workflows.

## Team Members
- **CoordinatorPM** (team leader instructions) – manages stages, handles approvals in casual language, and updates session state via helper tools (`set_stage`, `set_awaiting`, `mark_approval`, `record_visual_choice`).
- **ResearchAgent** – checks viability with Perplexity `perplexity_search` and returns a verdict with citations.
- **VisualAgent** – shares three branded mockups as descriptive briefs (no image calls yet) and keeps the tone laid-back.
- **ProductAgent** – writes the v1 product spec, BOM, and open questions.
- **SourcingAgent** – finds ingredients and manufacturers via Perplexity search.

Approvals are conversational: phrases like “yeah, looks good, continue” are treated as green lights. Users can ask for tweaks with natural language (e.g. “hmm, can we adjust the packaging vibe?”) and the coordinator loops back before advancing the stage.

## Session State & Gates
The team stores session state with `add_session_state_to_context=True` and `enable_agentic_state=True`. CoordinatorPM uses the helper tools to mutate state, so stage/approval changes persist. Stages progress `intake → viability → visuals → spec → sourcing → final` only after a casual approval is detected. See the JSON scaffold in `docs/TEAM_PLAN.md` for exact fields.

## Environment
Set these variables before running the team or the FastAPI app:

- `OPENROUTER_API_KEY` – required for all OpenRouter models and the coordinator.
- `PERPLEXITY_API_KEY` – enables the Perplexity MCP server (`npx -y @perplexity-ai/mcp-server`). Optional `PERPLEXITY_TIMEOUT_MS` overrides the default timeout.

Image generation is currently disabled; when we re-enable it we’ll document the additional `OPENAI_API_KEY` dependency.

Keep `AgentOS.serve` without `reload=True`; hot reload disrupts MCP lifecycle.
