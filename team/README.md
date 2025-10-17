# Product Innovation Team

This package wraps the Product Innovation Team workflow used by the AgentOS app. It defines a sequence of agents that collaborate on new product concepts, passing context step-by-step until a user-ready summary is produced.

## Workflow Overview
1. **ResearchAgent** – mines market trends, customer needs, and competitor moves for the brief.
2. **VisualiserAgent** – turns the research into a descriptive visual brief, including look, feel, and open questions.
3. **BuildValidationTeam** – a sub-team that first drafts specs via ProductGenerationAgent, then validates ingredients/components with AcademicResearchAgent and appends the findings.
4. **InterfaceAgent** – packages everything into a user-facing summary with recommended next steps.

All agents run via OpenRouter (`x-ai/grok-4-fast`). The workflow is reused both as a standalone script (`python -m team.innovation_team`) and inside the FastAPI app exposed by `agentos_app.py`.

## Environment
Set `OPENROUTER_API_KEY` (optionally via `.env`) before invoking the workflow so each agent can call OpenRouter.
