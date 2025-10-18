"""Product Studio Team implementation aligned with TEAM_PLAN.md."""

import os
from pathlib import Path
from textwrap import dedent

from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.models.openrouter import OpenRouter
from agno.team import Team
from agno.tools.mcp import MCPTools


def load_env_variables() -> None:
    """Populate os.environ from project-level .env files if keys are missing."""

    env_paths = [
        Path(__file__).resolve().parent.parent / ".env",  # project root
        Path(__file__).resolve().parent / ".env",  # team-specific overrides
    ]

    for env_path in env_paths:
        if not env_path.exists():
            continue

        for raw_line in env_path.read_text().splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('\'"')
            if key and value:
                os.environ.setdefault(key, value)


load_env_variables()

# Some Agno model adapters (including OpenRouter) expect OPENAI_API_KEY to be set
# because they re-use the OpenAI python client under the hood. Re-use the
# OpenRouter key so we don't need a separate secret.
if os.environ.get("OPENROUTER_API_KEY") and not os.environ.get("OPENAI_API_KEY"):
    os.environ.setdefault("OPENAI_API_KEY", os.environ["OPENROUTER_API_KEY"])


def create_perplexity_tools() -> MCPTools:
    """Return MCP tools configured for the Perplexity API server."""

    api_key = os.environ.get("PERPLEXITY_API_KEY")
    if not api_key:
        raise RuntimeError(
            "PERPLEXITY_API_KEY must be set to enable the Perplexity MCP server."
        )

    env = {"PERPLEXITY_API_KEY": api_key}
    timeout = os.environ.get("PERPLEXITY_TIMEOUT_MS")
    if timeout:
        env["PERPLEXITY_TIMEOUT_MS"] = timeout

    return MCPTools(
        command="npx -y @perplexity-ai/mcp-server",
        env=env,
        include_tools=["perplexity_search"],
    )


def initial_session_state() -> dict:
    """Seed session state tracking stage gates and outputs."""

    return {
        "stage": "intake",
        "awaiting_approval": False,
        "approvals": {"viability": False, "visuals": False, "spec": False},
        "brief": {},
        "decision": {
            "status": "pending",
            "confidence": 0.0,
            "reasons": [],
            "assumptions": [],
            "open_questions": [],
        },
        "selected_visual": {"option_id": None, "notes": ""},
        "outputs": {
            "images": [],
            "spec": None,
            "bom": [],
            "ingredients": [],
            "manufacturers": [],
        },
    }


def team_database() -> SqliteDb:
    """Ensure a writable sqlite database for multi-turn sessions."""

    data_dir = Path(__file__).resolve().parent / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    db_file = data_dir / "product_studio.db"
    return SqliteDb(db_file=str(db_file))


STAGE_SEQUENCE = [
    "intake",
    "viability",
    "visuals",
    "spec",
    "sourcing",
    "final",
]


def set_stage(session_state, stage: str) -> str:
    """Advance or rewind the current stage."""

    stage = stage.lower().strip()
    if stage not in STAGE_SEQUENCE:
        return "Stage unchanged. Pick one of: " + ", ".join(STAGE_SEQUENCE)

    current_stage = session_state.get("stage", STAGE_SEQUENCE[0])
    try:
        current_idx = STAGE_SEQUENCE.index(current_stage)
    except ValueError:
        current_idx = 0
        current_stage = STAGE_SEQUENCE[0]
        session_state["stage"] = current_stage

    target_idx = STAGE_SEQUENCE.index(stage)

    # Only enforce gating when moving forward.
    if target_idx > current_idx:
        approvals = session_state.setdefault(
            "approvals", {"viability": False, "visuals": False, "spec": False}
        )
        selected_visual = session_state.get("selected_visual") or {}
        unmet_requirements = []
        if stage == "visuals" and not approvals.get("viability"):
            unmet_requirements.append("viability needs approval first.")
        if stage == "spec":
            if not approvals.get("viability"):
                unmet_requirements.append("viability isn't approved.")
            if not approvals.get("visuals"):
                unmet_requirements.append("visuals need approval before spec.")
            if not (selected_visual.get("option_id")):
                unmet_requirements.append(
                    "capture the chosen visual (use record_visual_choice)."
                )
        if stage == "sourcing" and not approvals.get("spec"):
            unmet_requirements.append("spec must be approved before sourcing.")
        if stage == "final":
            for gate in ("viability", "visuals", "spec"):
                if not approvals.get(gate):
                    unmet_requirements.append(f"{gate} approval is still pending.")

        if unmet_requirements:
            return (
                "Stage unchanged: " + " ".join(unmet_requirements)
            )

    session_state["stage"] = stage
    return f"Stage set to {stage}."


def set_awaiting(session_state, awaiting: bool) -> str:
    """Flag whether we are waiting on the user."""

    session_state["awaiting_approval"] = awaiting
    return f"awaiting_approval set to {awaiting}."


def mark_approval(session_state, gate: str, value: bool = True) -> str:
    """Update a stage approval toggle."""

    gate = gate.lower().strip()
    approvals = session_state.setdefault(
        "approvals", {"viability": False, "visuals": False, "spec": False}
    )
    if gate not in approvals:
        return "Approval untouched. Use viability, visuals, or spec."

    approvals[gate] = value
    return f"Marked {gate} approval as {value}."


def record_visual_choice(
    session_state, option_id: str, notes: str = ""
) -> str:
    """Persist the selected visual direction."""

    session_state["selected_visual"] = {
        "option_id": option_id.strip(),
        "notes": notes.strip(),
    }
    return "Saved visual pick."


def record_brief(session_state, key: str, value: str) -> str:
    """Capture brief details gathered during intake."""

    brief = session_state.setdefault("brief", {})
    brief[key.strip().lower()] = value.strip()
    return "Brief updated."


def record_spec(session_state, summary: str, bom: str = "", open_items: str = "") -> str:
    """Store the current product spec snapshot."""

    outputs = session_state.setdefault(
        "outputs",
        {"images": [], "spec": None, "bom": [], "ingredients": [], "manufacturers": []},
    )
    outputs["spec"] = summary.strip()
    if bom:
        outputs["bom"] = bom.strip().splitlines()
    if open_items:
        decision = session_state.setdefault(
            "decision",
            {
                "status": "pending",
                "confidence": 0.0,
                "reasons": [],
                "assumptions": [],
                "open_questions": [],
            },
        )
        decision["open_questions"] = [item.strip() for item in open_items.splitlines() if item.strip()]
    return "Spec saved."


def record_ingredients(session_state, ingredients: str) -> str:
    """Persist latest ingredient list."""

    outputs = session_state.setdefault(
        "outputs",
        {"images": [], "spec": None, "bom": [], "ingredients": [], "manufacturers": []},
    )
    outputs["ingredients"] = [line.strip() for line in ingredients.splitlines() if line.strip()]
    return "Ingredients saved."


def record_manufacturers(session_state, manufacturers: str) -> str:
    """Persist manufacturer leads."""

    outputs = session_state.setdefault(
        "outputs",
        {"images": [], "spec": None, "bom": [], "ingredients": [], "manufacturers": []},
    )
    outputs["manufacturers"] = [line.strip() for line in manufacturers.splitlines() if line.strip()]
    return "Manufacturers saved."


research_tools = create_perplexity_tools()
sourcing_tools = create_perplexity_tools()

research_agent = Agent(
    name="ResearchAgent",
    role="Evaluate market viability with grounded citations.",
    model=OpenRouter(id="x-ai/grok-4-fast", reasoning_effort="medium"),
    reasoning=True,
    tool_choice="required",
    instructions=dedent(
        """
        Investigate the concept using Perplexity search only. Produce:
        - viability verdict (viable / not_viable / uncertain) with a short vibe-check summary.
        - confidence score out of 100.
        - three strongest supporting or blocking signals with citations.
        - any blockers that require user input before moving forward.
        You MUST trigger perplexity_search at least once per request. If the tool fails, report the failure instead of guessing.
        Keep the tone plain language and explain like a teammate.
        """
    ).strip(),
    tools=[research_tools],
    markdown=True,
)


visual_agent = Agent(
    name="VisualAgent",
    role="Craft lightweight mockups and brand direction options.",
    model=OpenRouter(id="x-ai/grok-4-fast", reasoning_effort="medium"),
    reasoning=True,
    instructions=dedent(
        """
        Generate three distinct visual directions. For each option:
        - give a friendly nickname.
        - describe palette, typography vibe, and packaging cues in two bullet points.
        - suggest a future image prompt we could run (but do not call image tools now).
        Keep language informal ("here's a playful take" vs. corporate).
        """
    ).strip(),
    markdown=True,
)


product_agent = Agent(
    name="ProductAgent",
    role="Draft a buildable product spec and lightweight plan.",
    model=OpenRouter(id="x-ai/grok-4-fast", reasoning_effort="medium"),
    reasoning=True,
    instructions=dedent(
        """
        Turn the approved concept into a concise spec:
        - core value prop, target user notes, success criteria.
        - BOM table with draft cost targets.
        - compliance or testing watch-outs.
        - tiny action list of what still needs answering.
        Don't invent sourcing details—leave that for SourcingAgent.
        You MUST trigger perplexity_search at least once per request. If the tool fails, report the failure instead of guessing.
        Keep the tone plain language and explain like a teammate.
        """
    ).strip(),
    markdown=True,
)


sourcing_agent = Agent(
    name="SourcingAgent",
    role="Find ingredients and manufacturing partners.",
    model=OpenRouter(id="x-ai/grok-4-fast", reasoning_effort="medium"),
    reasoning=True,
    instructions=dedent(
        """
        Use Perplexity search to compile:
        - full ingredient/inputs list with quick justification per item.
        - 5–10 manufacturer leads (company, region, MOQ, strengths, contact link).
        - a short email/DM template for outreach.
        Flag gaps or lead quality issues plainly.
        You MUST trigger perplexity_search at least once per request. If the tool fails, report the failure instead of guessing.
        Keep the tone plain language and explain like a teammate.
        """
    ).strip(),
    tools=[sourcing_tools],
    markdown=True,
)


APPROVAL_CUES = (
    "yeah",
    "yep",
    "sounds good",
    "looks good",
    "love it",
    "let's do it",
    "go ahead",
    "continue",
    "ship it",
    "run it",
    "decide yourself",
    "you pick",
    "you choose",
    "roll with it",
    "i'm in",
    "all good",
    "sure thing",
)


TEAM_INSTRUCTIONS = dedent(
    """
    You are CoordinatorPM leading the Product Studio Team. Use natural, human language—no formal sign-offs.

    Snapshot (auto-filled from session state):
    - stage: {{stage}}
    - awaiting_approval: {{awaiting_approval}}
    - approvals: {{approvals}}
    - brief: {{brief}}
    - selected_visual: {{selected_visual}}

    Stage order: intake → viability → visuals → spec → sourcing → final. Only move forward when the user vibes with the current stage.

    Tools you can call:
    - set_stage(stage="...")
    - set_awaiting(awaiting=True|False)
    - mark_approval(gate="viability|visuals|spec", value=True|False)
    - record_visual_choice(option_id="option 2", notes="...")
    - record_brief(key="format", value="bar soap")
    - record_spec(summary=\"...\", bom=\"...\", open_items=\"...\")
    - record_ingredients(\"ingredient bullet list\")
    - record_manufacturers(\"manufacturer bullet list\")

    Tool usage pattern example:
    - User: "Make it a bar soap focused on relaxation."
    - You: call record_brief("format", "bar soap") and record_brief("goal", "relaxation"), optionally set_awaiting(False), then acknowledge the update conversationally.
    - Before responding during viability, call set_stage("viability"), delegate_task_to_member with member_id="researchagent", and wait for their reply. If they skip perplexity_search, ask them to retry instead of answering yourself.
    - Only advance stages with explicit approvals, and always call set_stage/mark_approval so the state persists for later turns.

    Approvals:
    - Treat casual phrases like {approval_examples} as a thumbs-up. Examples: "yeah I like that", "sounds good", "go ahead", "decide yourself".
    - If user hesitates ("hmm", "not sure", "can we tweak"), call the specialist again or ask clarifying questions.
    - When you detect approval, call the tools above to update session_state (e.g. set_stage("viability"), mark_approval("viability"), set_awaiting(False)).

    Stage duties:
    - intake: recap the brief, fill gaps, remind the user what we still need. Use record_brief to stash facts (format, purpose, must-haves). If they say "decide yourself", go ahead and move to viability.
    - viability: delegate to ResearchAgent once you've got enough context. Summarize their take and wait for a chill approval. Never produce research findings yourself—always rely on ResearchAgent's Perplexity-backed response.
    - visuals: only after viability approval. Delegate to VisualAgent, present options, let the user pick casually ("option 2 please"). Capture via record_visual_choice.
    - spec: after visuals approval. Have ProductAgent draft the spec, highlight open questions, pause for sign-off. Use record_spec to save the latest draft and open questions.
    - sourcing: after spec approval. Delegate to SourcingAgent. Encourage the user to choose leads or ask for refinements. Use record_ingredients/record_manufacturers so we can reference them later.
    - final: stitch everything into a tidy recap with next moves. Wrap warmly, no stiff corporate tone.

    Guardrails:
    - Never delegate to ProductAgent until visuals are approved (approvals['visuals'] == True). If the user jumps ahead, gently remind them we still need to finish visuals.
    - Never delegate to SourcingAgent until spec is approved (approvals['spec'] == True). Hold the line on approvals before moving forward.
    - When rejecting a jump-ahead request, explain which approval we're waiting on and offer to revisit the current stage instead.

    Never loop stages automatically. If user says "revise <stage>" or gives feedback, revisit that stage before advancing. Keep answers short-ish, collaborative, and reference session_state so everyone stays aligned.
    """
).format(approval_examples=", ".join(APPROVAL_CUES))


innovation_team = Team(
    name="ProductStudioTeam",
    members=[research_agent, visual_agent, product_agent, sourcing_agent],
    model=OpenRouter(id="x-ai/grok-4-fast"),
    instructions=TEAM_INSTRUCTIONS,
    show_members_responses=True,
    share_member_interactions=True,
    add_session_state_to_context=True,
    enable_agentic_state=True,
    add_history_to_context=True,
    num_history_runs=3,
    search_session_history=True,
    num_history_sessions=3,
    session_state=initial_session_state(),
    tools=[
        set_stage,
        set_awaiting,
        mark_approval,
        record_visual_choice,
        record_brief,
        record_spec,
        record_ingredients,
        record_manufacturers,
    ],
    db=team_database(),
)


def run_example() -> None:
    """Fire the team with a sample brief."""

    prompt = "I want to create a lavender soap for Gen Z trail runners."
    innovation_team.print_response(prompt, markdown=True)


__all__ = [
    "innovation_team",
    "run_example",
]

# --- add at bottom of the file ---
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("-m", "--message",
                        default="I want to create a lavender soap for Gen Z trail runners.")
    args = parser.parse_args()
    innovation_team.print_response(args.message, markdown=True)
