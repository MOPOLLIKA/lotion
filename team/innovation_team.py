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
    """Populate os.environ from a local .env file if keys are missing."""

    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('\'"')
        os.environ.setdefault(key, value)


load_env_variables()


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


research_tools = create_perplexity_tools()
sourcing_tools = create_perplexity_tools()


research_agent = Agent(
    name="ResearchAgent",
    role="Evaluate market viability with grounded citations.",
    model=OpenRouter(id="x-ai/grok-4-fast"),
    instructions=dedent(
        """
        Investigate the concept using Perplexity search only. Produce:
        - viability verdict (viable / not_viable / uncertain) with a short vibe-check summary.
        - confidence score out of 100.
        - three strongest supporting or blocking signals with citations.
        - any blockers that require user input before moving forward.
        Keep the tone plain language and explain like a teammate.
        """
    ).strip(),
    tools=[research_tools],
    markdown=True,
)


visual_agent = Agent(
    name="VisualAgent",
    role="Craft lightweight mockups and brand direction options.",
    model=OpenRouter(id="x-ai/grok-4-fast"),
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
    model=OpenRouter(id="x-ai/grok-4-fast"),
    instructions=dedent(
        """
        Turn the approved concept into a concise spec:
        - core value prop, target user notes, success criteria.
        - BOM table with draft cost targets.
        - compliance or testing watch-outs.
        - tiny action list of what still needs answering.
        Don't invent sourcing details—leave that for SourcingAgent.
        """
    ).strip(),
    markdown=True,
)


sourcing_agent = Agent(
    name="SourcingAgent",
    role="Find ingredients and manufacturing partners.",
    model=OpenRouter(id="x-ai/grok-4-fast"),
    instructions=dedent(
        """
        Use Perplexity search to compile:
        - full ingredient/inputs list with quick justification per item.
        - 5–10 manufacturer leads (company, region, MOQ, strengths, contact link).
        - a short email/DM template for outreach.
        Flag gaps or lead quality issues plainly.
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
    - selected_visual: {{selected_visual}}

    Stage order: intake → viability → visuals → spec → sourcing → final. Only move forward when the user vibes with the current stage.

    Approvals:
    - Treat casual phrases like {approval_examples} as a thumbs-up. Examples: "yeah I like that", "sounds good", "go ahead", "decide yourself".
    - If user hesitates ("hmm", "not sure", "can we tweak"), call the specialist again or ask clarifying questions.
    - When you detect approval, explicitly show the session_state edits using Python-style lines, e.g. `session_state['stage'] = 'viability'`, `session_state['approvals']['viability'] = True`, `session_state['awaiting_approval'] = False`. Place them under a short "State tweaks:" bullet so the platform can apply them.

    Stage duties:
    - intake: recap the brief, fill gaps, remind the user what we still need. If they say "decide yourself", go ahead and move to viability.
    - viability: delegate to ResearchAgent once you've got enough context. Summarize their take and wait for a chill approval.
    - visuals: only after viability approval. Delegate to VisualAgent, present options, let the user pick casually ("option 2 please"). Echo their choice back.
    - spec: after visuals approval. Have ProductAgent draft the spec, highlight open questions, pause for sign-off.
    - sourcing: after spec approval. Delegate to SourcingAgent. Encourage the user to choose leads or ask for refinements.
    - final: stitch everything into a tidy recap with next moves. Wrap warmly, no stiff corporate tone.

    Never loop stages automatically. If user says "revise <stage>" or gives feedback, revisit that stage before advancing. Keep answers short-ish, collaborative, and reference session_state so everyone stays aligned.
    """
).format(approval_examples=", ".join(APPROVAL_CUES))


innovation_team = Team(
    name="ProductStudioTeam",
    members=[research_agent, visual_agent, product_agent, sourcing_agent],
    model=OpenRouter(id="x-ai/grok-4-fast"),
    instructions=TEAM_INSTRUCTIONS,
    show_members_responses=True,
    add_session_state_to_context=True,
    enable_agentic_state=True,
    session_state=initial_session_state(),
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
