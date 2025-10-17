# Product Studio Team — Single-Team, Stage‑Gated Plan

A concise, human-in-the-loop agent team for product ideation through sourcing. One team, no subteams, with explicit stage gates and Perplexity‑grounded research.

## Goals
- Prevent runaway loops; always pause at stage gates for approval.
- Ground research and supplier discovery with Perplexity (`perplexity_search`).
- Generate concise visuals only after viability is approved.
- Produce a minimal, actionable spec and manufacturer shortlist.

## Stages (Linear, User‑Gated)
- Stage 0 — Intake
  - Collect goal, audience, constraints (budget, timing, region, compliance).
  - Output: intake summary + missing info; set `stage=intake`.
- Stage 1 — Viability Check
  - Research via Perplexity; analyze competition, demand signals, moats/risks.
  - Output: decision = viable | not_viable | uncertain; confidence; risks; citations.
  - Gate: wait for “approve viability” or “revise viability …”.
- Stage 2 — Visuals
  - 2–3 mockups + style brief; show deltas between options.
  - Output: images, style notes; `selected_visual` set on approval.
  - Gate: “approve visuals: option <n>” or “revise visuals …”.
- Stage 3 — Product Spec
  - Draft v1 spec and BOM; compliance notes; small test plan.
  - Output: `spec.md`, `bom[]`, open unknowns.
  - Gate: “approve spec” / “revise spec …”.
- Stage 4 — Ingredients + Manufacturers
  - Use Perplexity to form full ingredient list and 5–10 manufacturer leads (region, MOQ, links, contacts) + outreach template.
  - Gate: user selects candidates or asks to refine.
- Stage 5 — Final Pack
  - Summary with decisions, chosen visuals, final spec/BOM, supplier shortlist, next steps.

## Agents (Single Team, No Subteams)
- CoordinatorPM
  - Orchestrates stages, enforces gates, writes/reads session state, asks for approvals.
  - Keeps track of stage/approval shifts via the shared session state so the rest of the team stays aligned.
  - Never advances stage without explicit approval; supports “revise <stage>”.
- ResearchAgent
  - Market/competitive analysis, viability scoring, citations.
  - Tools: MCPTools `include_tools=["perplexity_search"]`.
- VisualAgent
  - Mockups + style brief; present distinct options.
  - (Current build ships without auto image generation; draft prompts instead. Add `OpenAITools` later if desired.)
- ProductAgent
  - Crisp v1 spec and BOM; compliance and test notes; defers deep extras unless asked.
- SourcingAgent
  - Ingredients list + manufacturer discovery and formatting.
  - Tools: MCPTools `include_tools=["perplexity_search"]`.

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
- Perplexity MCP: instantiate a fresh `MCPTools(command="npx -y @perplexity-ai/mcp-server", include_tools=["perplexity_search"])` per agent that needs it (ResearchAgent, SourcingAgent).
  - Env: `PERPLEXITY_API_KEY` (required), optional `PERPLEXITY_TIMEOUT_MS`.
  - Requires Node ≥ 18 and `npx`.
- Persistence: back the team with `SqliteDb` stored under `team/data/product_studio.db` so multi-turn chats persist without extra setup.
- Image generation: optional future step; currently VisualAgent drafts prompts instead of calling tools.
- AgentOS: run without `reload=True` to avoid MCP lifecycle issues.

## Example Prompt
“I want to make a lavender soap for Gen Z.”
- Stage 1: return viability decision + confidence, top risks, citation list.
- Stage 2: present 3 mockups (e.g., ‘playful pastel’, ‘eco‑minimal’, ‘bold neon’) + style notes; wait for selection.
- Stage 3: deliver v1 spec + BOM + compliance notes + small test plan.
- Stage 4: ingredients list + 5–10 manufacturers (region/MOQ/link/contact) + outreach email.
- Stage 5: final pack and next steps.

## User Commands (suggested)
- “approve viability” | “revise viability: …”
- “approve visuals: option 2” | “revise visuals: …”
- “approve spec” | “revise spec: …”
- “narrow manufacturers to EU only” | “increase MOQ tolerance to 2k units”

## Implementation Checklist
- [ ] Replace subteam with single Team (`ProductStudioTeam`).
- [ ] Add CoordinatorPM with gating instructions and session state writes/reads.
- [ ] Ensure ResearchAgent & SourcingAgent use Perplexity `perplexity_search` only.
- [ ] Add VisualAgent with image generation only; persist images to disk.
- [ ] Add ProductAgent spec/BOM scaffold (`spec.md` writer).
- [ ] Expose clear commands in the chat header/help.

## Non‑Goals (initial cut)
- Autonomous multi‑turn self‑revisions without user approval.
- Broad web browsing tools beyond Perplexity search.
- Complex parallelization; we keep the flow linear for clarity.
