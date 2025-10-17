# Product Innovation Team

This package wraps the Product Innovation Team workflow used by the AgentOS app. It defines a sequence of agents that collaborate on new product concepts, passing context step-by-step until a user-ready summary is produced.

## Workflow Overview
1. **ResearchAgent** – mines market trends, customer needs, and competitor moves for the brief. It now calls the Perplexity MCP server's `perplexity_search` tool for live results.
2. **VisualiserAgent** – turns the research into a descriptive visual brief, including look, feel, and open questions.
3. **BuildValidationTeam** – a sub-team that first drafts specs via ProductGenerationAgent, then validates ingredients/components with AcademicResearchAgent and appends the findings.
4. **InterfaceAgent** – packages everything into a user-facing summary with recommended next steps.

All agents run via OpenRouter (`x-ai/grok-4-fast`). Research-oriented agents (ResearchAgent, AcademicResearchAgent) also load the Perplexity MCP server via `MCPTools`, but with only the `perplexity_search` tool enabled to keep outputs focused on concise search results. The workflow is reused both as a standalone script (`python -m team.innovation_team`) and inside the FastAPI app exposed by `agentos_app.py`.

## Environment
Set the following environment variables before invoking the workflow:

- `OPENROUTER_API_KEY` – needed for Agno's OpenRouter models.
- `PERPLEXITY_API_KEY` – required for the Perplexity MCP server (`npx -y @perplexity-ai/mcp-server`). Optionally set `PERPLEXITY_TIMEOUT_MS` to override the default 5-minute timeout.

When running the FastAPI app with MCP tools enabled, avoid `reload=True` with `AgentOS.serve`, as hot reloading can break MCP connections.
