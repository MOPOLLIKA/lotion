# Product Studio Team — Single-Team, Stage‑Gated Plan

A concise, human-in-the-loop agent team for product ideation through sourcing. One team, no subteams, with explicit stage gates, Grok reasoning, and Perplexity Search API grounding.

## Goals
- Prevent runaway loops; always pause at stage gates for approval.
- Ground research and supplier discovery with the Perplexity Search API (`perplexity_search`) and Grok reasoning models.
- Generate concise visuals only after viability is approved.
- Produce a minimal, actionable spec and manufacturer shortlist.

## Stages (Linear, User‑Gated)
- Stage 0 — Intake
  - Collect goal, audience, constraints (budget, timing, region, compliance).
  - Output: intake summary + missing info; set `stage=intake`.
- Stage 1 — Viability Check
  - Research via Grok-4 fast + `perplexity_search`; analyze competition, demand signals, moats/risks.
  - Output: decision = viable | not_viable | uncertain; confidence; risks; citations.
  - Gate: wait for “approve viability” or “revise viability …”.
- Stage 2 — Visuals
  - Single mockup + style brief capturing the chosen direction.
  - Output: image, style notes; `selected_visual` set on approval.
  - Gate: “approve visuals” or “revise visuals …”.
- Stage 3 — Product Spec
  - Draft v1 spec and BOM; compliance notes; small test plan.
  - Output: `spec.md`, `bom[]`, open unknowns.
  - Gate: “approve spec” / “revise spec …”.
- Stage 4 — Ingredients + Manufacturers
  - Use Grok-4 fast + `perplexity_search` to form full ingredient list and 5–10 manufacturer leads (region, MOQ, links, contacts) + outreach template.
  - Gate: user selects candidates or asks to refine.
- Stage 5 — Final Pack
  - Summary with decisions, chosen visuals, final spec/BOM, supplier shortlist, next steps.

## Agents (Single Team, No Subteams)
- CoordinatorPM
  - Orchestrates stages, enforces gates, writes/reads session state, asks for approvals.
  - Uses small helper tools (`set_stage`, `set_awaiting`, `mark_approval`, `record_brief`, `record_visual_choice`) to mutate shared state so every stage change persists.
  - Never advances stage without explicit approval; supports “revise <stage>”.
- ResearchAgent
  - Market/competitive analysis, viability scoring, citations.
  - Model: OpenRouter `x-ai/grok-4-fast` with reasoning.
  - Tools: custom `perplexity_search` (Perplexity Search API) with a post-hook safeguard and Coordinator reminders to keep results grounded.
- VisualAgent
  - Mockup + style brief; focus on one clear direction at a time.
  - (Current build ships without auto image generation; draft prompts instead. Add `OpenAITools` later if desired.)
- ProductAgent
  - Crisp v1 spec and BOM; compliance and test notes; defers deep extras unless asked.
- SourcingAgent
  - Ingredients list + manufacturer discovery and formatting.
  - Model: OpenRouter `x-ai/grok-4-fast` with reasoning.
  - Tools: custom `perplexity_search` (Perplexity Search API) with Coordinator nudges and the same post-hook enforcement.

## Session State (shared)
```json
{
  "stage": "intake|viability|visuals|spec|sourcing|final",
  "awaiting_approval": true,
  "approvals": {"viability": false, "visuals": false, "spec": false},
  "decision": {"status": "viable|not_viable|uncertain", "confidence": 0.0,
                "reasons": [], "assumptions": [], "open_questions": []},
  "selected_visual": {"option_id": null, "notes": ""},
  "outputs": {"images": [], "spec": null, "bom": [],
               "ingredients": [], "manufacturers": []}
}
```
Implementation flags: set `add_session_state_to_context=True` and `enable_agentic_state=True` for the Team and CoordinatorPM.

## Gating Rules (Coordinator)
- Advance stage only if the corresponding `approvals[stage] == true`.
- If `decision.status != "viable"`, stop and propose 2–3 pivots; wait.
- Do not re‑enter completed stages unless the user says “revise <stage> …”.

## Tools & Env
- Perplexity Search API: custom `perplexity_search` tool wraps `https://api.perplexity.ai/search`.
  - Env: `PERPLEXITY_API_KEY` (required), optional `PERPLEXITY_TIMEOUT_MS` (milliseconds) and `PERPLEXITY_SEARCH_URL` override.
- Persistence: back the team with `SqliteDb` stored under `team/data/product_studio.db` so multi-turn chats persist without extra setup.
- Image generation: optional future step; currently VisualAgent drafts prompts instead of calling tools.
- AgentOS: run without `reload=True` to avoid MCP lifecycle issues.

## Example Prompt
“I want to make a lavender soap for Gen Z.”
- Stage 1: return viability decision + confidence, top risks, citation list.
- Stage 2: present a single mockup (e.g., ‘eco‑minimal lavender calm’) with style notes; wait for approval.
- Stage 3: deliver v1 spec + BOM + compliance notes + small test plan.
- Stage 4: ingredients list + 5–10 manufacturers (region/MOQ/link/contact) + outreach email.
- Stage 5: final pack and next steps.

## User Commands (suggested)
- “approve viability” | “revise viability: …”
- “approve visuals” | “revise visuals: …”
- “approve spec” | “revise spec: …”
- “narrow manufacturers to EU only” | “increase MOQ tolerance to 2k units”

## Implementation Checklist
- [ ] Replace subteam with single Team (`ProductStudioTeam`).
- [ ] Add CoordinatorPM with gating instructions and session state writes/reads.
- [ ] Ensure ResearchAgent & SourcingAgent invoke `perplexity_search` at least once per run.
- [ ] Add VisualAgent with image generation only; persist images to disk.
- [ ] Add ProductAgent spec/BOM scaffold (`spec.md` writer).
- [ ] Expose clear commands in the chat header/help.

## Non‑Goals (initial cut)
- Autonomous multi‑turn self‑revisions without user approval.
- Broad web browsing tools beyond Grok/OpenRouter + Perplexity Search.
- Complex parallelization; we keep the flow linear for clarity.
