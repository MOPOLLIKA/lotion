"""Simple Agno team and workflow wired to OpenRouter models.

Set `OPENROUTER_API_KEY` in your environment before running this module:

    export OPENROUTER_API_KEY=sk-...

Run the workflow example:

    python -m team.innovation_team
"""

import os
from pathlib import Path

from agno.agent import Agent
from agno.models.openrouter import OpenRouter
from agno.team import Team
from agno.workflow import Workflow


def load_env_variables():
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

# Core agents used by the team leader. Each agent uses the x-ai/grok-4-fast model via OpenRouter.
research_agent = Agent(
    name="ResearchAgent",
    role="Explores market trends, competitor moves, and consumer insights.",
    model=OpenRouter(id="x-ai/grok-4-fast"),
    instructions=(
        "Study the market landscape for the product topic. Return 2-3 key trends, "
        "an overview of audience needs, and notable competitor moves. "
        "Flag any open questions VisualiserAgent should clarify."
    ),
    markdown=True,
)

visualiser_agent = Agent(
    name="VisualiserAgent",
    role="Sketches the product concept through descriptive mockups.",
    model=OpenRouter(id="x-ai/grok-4-fast"),
    instructions=(
        "Translate ResearchAgent insights into a concise visual brief. "
        "Describe look, feel, hero features, and packaging notes. "
        "List assumptions that ProductGenerationAgent must validate."
    ),
    markdown=True,
)

product_generation_agent = Agent(
    name="ProductGenerationAgent",
    role="Outlines product specs, build steps, and launch checklist.",
    model=OpenRouter(id="x-ai/grok-4-fast"),
    instructions=(
        "Define the product version 1. Include bill of materials, core specs, "
        "build sequence, and a lightweight go-to-market outline. "
        "Provide a bullet list of ingredients/components needing validation."
    ),
    markdown=True,
)

academic_research_agent = Agent(
    name="AcademicResearchAgent",
    role="Validates ingredients or components with academic sources.",
    model=OpenRouter(id="x-ai/grok-4-fast"),
    instructions=(
        "Review ProductGenerationAgent's component list. "
        "Validate safety/effectiveness via academic or regulatory references. "
        "Highlight any risks or missing data, citing sources when possible."
    ),
    markdown=True,
)

interface_agent = Agent(
    name="InterfaceAgent",
    role="Summarizes outputs for the user and recommends next steps.",
    model=OpenRouter(id="x-ai/grok-4-fast"),
    instructions=(
        "Synthesize all previous outputs into a user-facing deliverable. "
        "Provide a clean summary, key decisions, validated ingredient notes, "
        "and the immediate next actions."
    ),
    markdown=True,
)

# Sub-team handles product planning followed by academic validation.
build_validation_team = Team(
    name="BuildValidationTeam",
    members=[product_generation_agent, academic_research_agent],
    model=OpenRouter(id="x-ai/grok-4-fast"),
    instructions=(
        "First delegate to ProductGenerationAgent to draft specs, "
        "then delegate to AcademicResearchAgent to validate the ingredient list. "
        "Ensure validation notes are appended to the specs before handing off."
    ),
    show_members_responses=True,
)

# Top-level team orchestrating the sequential flow.
innovation_team = Team(
    name="ProductInnovationTeam",
    members=[
        research_agent,
        visualiser_agent,
        build_validation_team,
        interface_agent,
    ],
    model=OpenRouter(id="x-ai/grok-4-fast"),
    instructions=(
        "Run a sequential pipeline: ResearchAgent → VisualiserAgent → "
        "BuildValidationTeam → InterfaceAgent. "
        "Always pass the prior step's output as context to the next actor."
    ),
    show_members_responses=True,
)

# Simple sequential workflow that reuses the same agents.
innovation_workflow = Workflow(
    name="InnovationPipelineWorkflow",
    description="Basic sequential flow from research to user-facing summary.",
    steps=[
        research_agent,
        visualiser_agent,
        build_validation_team,
        interface_agent,
    ],
)


def run_example():
    """Fire the workflow with a demo product brief."""
    prompt = "Ideate a moisturizing lotion for trail runners in cold climates."
    innovation_workflow.print_response(prompt, markdown=True)


if __name__ == "__main__":
    run_example()
