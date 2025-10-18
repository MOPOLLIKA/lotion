"""Product Studio Team implementation aligned with TEAM_PLAN.md."""

import os
import re
from pathlib import Path
from textwrap import dedent
from uuid import uuid4

import httpx
from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.media import Image
from agno.utils.log import logger
from agno.models.openrouter import OpenRouter
from agno.team import Team
from agno.tools import tool
from agno.tools.function import ToolResult


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


def _generate_media_impl(agent: Agent, prompt: str) -> ToolResult:
    """Generate an image via Replicate Seedream and persist the URL."""

    api_token = os.environ.get("REPLICATE_API_TOKEN")
    if not api_token:
        return ToolResult(content="Replicate token missing. Set REPLICATE_API_TOKEN.")

    try:
        import replicate
    except ImportError:  # pragma: no cover - defensive guard
        return ToolResult(content="`replicate` package missing. Run `pip install replicate`.")

    model_id = os.environ.get("REPLICATE_MODEL", "bytedance/seedream-4")

    request = {
        "prompt": prompt,
        "sequential_image_generation": os.environ.get("REPLICATE_SEQ_MODE", "disabled"),
        "max_images": int(os.environ.get("REPLICATE_MAX_IMAGES", "1")),
        "size": os.environ.get("REPLICATE_SIZE", "2K"),
    }

    aspect_ratio = os.environ.get("REPLICATE_ASPECT_RATIO")
    if aspect_ratio:
        request["aspect_ratio"] = aspect_ratio

    width = os.environ.get("REPLICATE_WIDTH")
    height = os.environ.get("REPLICATE_HEIGHT")
    if width and height:
        request["size"] = "custom"
        request["width"] = int(width)
        request["height"] = int(height)

    client = replicate.Client(api_token=api_token)

    try:
        outputs = client.run(model_id, input=request)
    except Exception as exc:  # pragma: no cover - API error surface
        return ToolResult(content=f"Replicate error: {exc}")

    urls = []
    file_outputs = []

    try:
        from replicate.helpers import FileOutput  # type: ignore
    except ImportError:
        FileOutput = None  # pragma: no cover

    if FileOutput and isinstance(outputs, FileOutput):
        file_outputs = [outputs]
    elif isinstance(outputs, (list, tuple)):
        for item in outputs:
            if FileOutput and isinstance(item, FileOutput):
                file_outputs.append(item)
            elif isinstance(item, str):
                urls.append(item)
    elif isinstance(outputs, str):
        urls.append(outputs)

    for file_output in file_outputs:
        url = getattr(file_output, "url", None)
        if url:
            urls.append(url)

    image_url = urls[0] if urls else None

    session_state = getattr(agent, "session_state", None)
    if session_state is None and hasattr(agent, "team"):
        session_state = getattr(agent.team, "session_state", None)

    if isinstance(session_state, dict) and image_url:
        outputs_state = session_state.setdefault(
            "outputs",
            {"images": [], "spec": None, "bom": [], "ingredients": [], "manufacturers": []},
        )
        images_state = outputs_state.setdefault("images", [])
        images_state.append({"prompt": prompt, "url": image_url})

    if image_url:
        images = [Image(id=str(uuid4()), url=url) for url in urls if url]
        return ToolResult(content=image_url, images=images or None)

    return ToolResult(content="Replicate did not return any image URLs.")


generate_media = tool(name="generate_media")(_generate_media_impl)


@tool(
    name="perplexity_search",
    description="Search the web via Perplexity. Args: query (str or list[str]); optional: country (ISO alpha-2), max_results (1-20), max_tokens_per_page (128-4096), search_domain_filter (list[str]). Returns a digest with titles, URLs, and snippets.",
    show_result=True,
)
def perplexity_search(
    agent: Agent | None = None,
    query: str | list[str] | None = None,
    max_results: int = 5,
    max_tokens_per_page: int = 1024,
    country: str | None = None,
    search_domain_filter: list[str] | None = None,
) -> ToolResult:
    """Call Perplexity's Search API and return a concise digest of the results."""

    api_key = os.environ.get("PERPLEXITY_API_KEY")
    if not api_key:
        return ToolResult(content="Perplexity search requires PERPLEXITY_API_KEY to be set.")

    if isinstance(query, (list, tuple)):
        normalized_query = [str(item).strip() for item in query if str(item).strip()]
    else:
        normalized_query = (query or "").strip()

    if isinstance(normalized_query, list) and not normalized_query:
        return ToolResult(content="Perplexity search needs at least one non-empty query string.")
    if isinstance(normalized_query, str) and not normalized_query:
        return ToolResult(content="Perplexity search needs a non-empty query string.")

    max_results = max(1, min(int(max_results or 1), 20))
    max_tokens_per_page = max(128, min(int(max_tokens_per_page or 1024), 4096))

    payload: dict[str, object] = {
        "query": normalized_query,
        "max_results": max_results,
        "max_tokens_per_page": max_tokens_per_page,
    }
    if country:
        payload["country"] = country
    if search_domain_filter:
        payload["search_domain_filter"] = search_domain_filter[:20]

    timeout_ms = os.environ.get("PERPLEXITY_TIMEOUT_MS")
    timeout = max(1.0, float(timeout_ms) / 1000.0) if timeout_ms else 30.0
    base_url = os.environ.get("PERPLEXITY_SEARCH_URL", "https://api.perplexity.ai/search")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    logger.info(
        "perplexity_search: sending request", extra={
            "query": normalized_query,
            "max_results": max_results,
            "country": country,
            "domains": search_domain_filter,
        }
    )

    try:
        response = httpx.post(base_url, headers=headers, json=payload, timeout=timeout)
        response.raise_for_status()
        data = response.json()
    except httpx.HTTPStatusError as exc:
        logger.error(
            "perplexity_search: HTTP error",
            extra={"status": exc.response.status_code, "body": exc.response.text[:200]},
        )
        body = exc.response.text.strip()
        diagnostic = body[:200] + ("..." if len(body) > 200 else "")
        message = f"Perplexity search failed with status {exc.response.status_code}: {diagnostic}"
        return ToolResult(content=message)
    except httpx.RequestError as exc:
        logger.error("perplexity_search: request exception", extra={"error": str(exc)})
        return ToolResult(content=f"Perplexity search request error: {exc}")
    except ValueError as exc:  # JSON decode error
        logger.error("perplexity_search: JSON decode error", extra={"error": str(exc)})
        return ToolResult(content=f"Perplexity search returned invalid JSON: {exc}")

    results = data.get("results")
    if not results:
        logger.warning("perplexity_search: no results", extra={"query": normalized_query})
        return ToolResult(content="Perplexity search returned no results.", data=data)

    lines: list[str] = []

    def _format_result(idx: int, item: dict[str, object]) -> None:
        title = str(item.get("title") or "Untitled result").strip()
        url = str(item.get("url") or "").strip()
        snippet = str(item.get("snippet") or "").strip()
        date = str(item.get("date") or item.get("last_updated") or "").strip()

        header = f"{idx}. {title}"
        if url:
            header += f" — {url}"
        lines.append(header)

        extras: list[str] = []
        if date:
            extras.append(date)
        if snippet:
            extras.append(snippet[:240].rstrip() + ("…" if len(snippet) > 240 else ""))
        if extras:
            lines.append("   " + " — ".join(extras))

    if isinstance(normalized_query, list):
        for q_index, query_results in enumerate(results):
            query_prompt = normalized_query[q_index] if q_index < len(normalized_query) else f"query #{q_index + 1}"
            lines.append(f"Query {q_index + 1}: {query_prompt}")
            if not query_results:
                lines.append("   No results returned.")
            else:
                for res_index, item in enumerate(query_results, start=1):
                    if isinstance(item, dict):
                        _format_result(res_index, item)
            lines.append("")
    else:
        for res_index, item in enumerate(results, start=1):
            if isinstance(item, dict):
                _format_result(res_index, item)

    content = "\n".join(line for line in lines if line.strip())
    logger.info("perplexity_search: returning results", extra={"num_lines": len(lines)})
    return ToolResult(content=content, data=data)


def _extract_user_query(run_output) -> str:
    """Pull the latest user query from the run output context."""

    if getattr(run_output, "input", None) and getattr(run_output.input, "input_content", None):
        raw = str(run_output.input.input_content or "").strip()
        if raw:
            return raw

    if getattr(run_output, "messages", None):
        for message in reversed(run_output.messages):
            if getattr(message, "role", "") == "user" and message.content:
                candidate = str(message.content).strip()
                if candidate:
                    return candidate

    return ""


def ensure_perplexity_usage(run_output, agent: Agent, **_kwargs) -> None:
    """Guarantee Perplexity-backed output for research and sourcing agents."""

    if agent.name not in {"ResearchAgent", "SourcingAgent"}:
        return

    tool_calls = getattr(run_output, "tool_calls", None)
    if tool_calls:
        return

    query = _extract_user_query(run_output) or "latest market research"

    try:
        tool_result = perplexity_search.entrypoint(
            agent=agent,
            query=query,
            max_results=10,
            max_tokens_per_page=1024,
        )
    except Exception as exc:  # pragma: no cover - surface plainly
        failure_note = f"Perplexity search failed: {exc}"
        run_output.content = (
            f"{run_output.content}\n\n{failure_note}" if run_output.content else failure_note
        )
        return

    summary_parts = [run_output.content.strip()] if run_output.content else []
    summary_parts.append(tool_result.content or "Perplexity search returned no content.")
    run_output.content = "\n\n".join(part for part in summary_parts if part)


def _extract_prompt(text: str) -> str:
    """Return the suggested prompt from the agent's response if present."""

    pattern = re.compile(r"suggested\s+future\s+image\s+prompt\s*[:：]\s*(.+)", re.IGNORECASE)
    for line in text.splitlines():
        match = pattern.search(line)
        if match:
            return match.group(1).strip().strip("`").strip()
    return ""


def _strip_prompt_line(text: str) -> str:
    cleaned_lines = []
    for line in text.splitlines():
        lower = line.lower()
        if "suggested future image prompt" in lower:
            continue
        if "image url" in lower:
            continue
        if "<xai:function_call" in lower or "<function_call" in lower:
            continue
        if "<parameter" in lower or "<argument" in lower:
            continue
        cleaned_lines.append(line)
    return "\n".join(cleaned_lines).strip()


def _collapse_markdown(text: str) -> str:
    """Simplify markdown formatting for alt text and summary lines."""

    cleaned = re.sub(r"[*_`]+", "", text)
    return " ".join(cleaned.split())


def _normalize_prompt(prompt: str) -> str:
    cleaned = _collapse_markdown(prompt.strip())
    if len(cleaned) > 220:
        cleaned = cleaned[:217].rstrip(",;:") + "..."
    return cleaned


def _first_sentence(text: str) -> str:
    """Extract the first meaningful sentence from markdown-ish content."""

    for line in text.splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        cleaned = cleaned.lstrip("-•*").strip()
        cleaned = _collapse_markdown(cleaned)
        if cleaned:
            return cleaned
    return "Here's the mockup we generated."


def attach_visual_mockup(run_output, agent: Agent, **_kwargs) -> None:
    """Ensure visual responses include a real Replicate image URL and embed."""

    if agent.name != "VisualAgent":
        return

    content = (run_output.content or "").strip()
    if not content:
        return

    if "Image URL:" in content and "replicate.delivery" in content:
        # Already contains a concrete link from Replicate.
        return

    prompt = _extract_prompt(content)
    if not prompt:
        # Fall back to using the descriptive text as prompt.
        prompt = _collapse_markdown(content)[:500]

    tool_result = _generate_media_impl(agent, prompt=prompt)
    image_url = None
    if getattr(tool_result, "images", None):
        for image in tool_result.images:
            if getattr(image, "url", None):
                image_url = image.url
                break
    if not image_url:
        image_url = (tool_result.content or "").strip()

    if not image_url or not image_url.startswith("http"):
        run_output.content = f"{content}\nImage generation failed: {tool_result.content or 'No image URL returned.'}"
        return

    summary_text = _strip_prompt_line(content)
    alt_text = "visual mockup"
    nickname_match = re.search(r"nickname\s*[:：]\s*([^\n]+)", content, re.IGNORECASE)
    if nickname_match:
        alt_text = _collapse_markdown(nickname_match.group(1))

    description = _first_sentence(summary_text)

    final_parts = [description]
    prompt_line = _normalize_prompt(prompt) if prompt else ""
    if prompt_line:
        final_parts.append(f"Prompt used: {prompt_line}")
    final_parts.append(f"Image URL: {image_url}")
    final_parts.append(f"![{alt_text}]({image_url})")

    run_output.content = "\n".join(part for part in final_parts if part)
    run_output.images = getattr(tool_result, "images", None)


research_agent = Agent(
    name="ResearchAgent",
    role="Evaluate market viability with grounded citations.",
    model=OpenRouter(id="google/gemini-2.5-flash-preview-09-2025"),
    reasoning=True,
    instructions=dedent(
        """
        Investigate the concept with up-to-date market context and provide:
        - viability verdict (viable / not_viable / uncertain) with a short vibe-check summary.
        - confidence score out of 100.
        - three strongest supporting or blocking signals with citations or source notes.
        - any blockers that require user input before moving forward.
        You MUST call `perplexity_search` at least once before finalizing a response. If the tool errors, surface the failure instead of guessing.
        If you cannot find recent evidence, be explicit instead of guessing.
        Keep the tone plain language and explain like a teammate.
        """
    ).strip(),
    tools=[perplexity_search],
    post_hooks=[ensure_perplexity_usage],
    tool_call_limit=1,
    markdown=True,
)


visual_agent = Agent(
    name="VisualAgent",
    role="Craft lightweight mockups and brand direction concepts.",
    model=OpenRouter(id="x-ai/grok-4-fast", reasoning_effort="medium"),
    reasoning=True,
    tools=[generate_media],
    post_hooks=[attach_visual_mockup],
    instructions=dedent(
        """
        Deliver one visual direction concept. Include:
        - a friendly nickname.
        - two quick bullets covering palette & typography vibe, plus packaging cues.
        - a suggested future image prompt (keep it short and vivid).
        When the user explicitly asks for a visual or mockup, you MUST call `generate_media` exactly once before replying. Never fabricate or guess an image URL.
        After the tool returns, reply with:
        - one short description sentence (no headings, no lists);
        - a line that begins with `Image URL:` plus the exact Replicate URL (no shortening);
        - a markdown image embed on the next line using the format `![alt text](URL)` so the interface displays it inline.
        Skip any extra analysis, tables, or section headers once the image is delivered.
        If Replicate returns an error or no URL, say so clearly and skip the mockup instead of improvising.
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
        """
    ).strip(),
    markdown=True,
)


sourcing_agent = Agent(
    name="SourcingAgent",
    role="Find ingredients and manufacturing partners.",
    model=OpenRouter(id="google/gemini-2.5-flash-preview-09-2025"),
    reasoning=True,
    instructions=dedent(
        """
        Compile sourcing insights with any references you can surface:
        - full ingredient/inputs list with quick justification per item.
        - 5–10 manufacturer leads (company, region, MOQ, strengths, contact link).
        - a short email/DM template for outreach.
        Note any gaps or lead quality concerns plainly.
        Always run `perplexity_search` before committing to a recommendation. If the tool fails, report the issue and request guidance.
        """
    ).strip(),
    tools=[perplexity_search],
    post_hooks=[ensure_perplexity_usage],
    tool_call_limit=1,
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
    - record_visual_choice(option_id="mockup", notes="...")
    - record_brief(key="format", value="bar soap")
    - record_spec(summary=\"...\", bom=\"...\", open_items=\"...\")
    - record_ingredients(\"ingredient bullet list\")
    - record_manufacturers(\"manufacturer bullet list\")

    Tool usage pattern example:
    - User: "Make it a bar soap focused on relaxation."
    - You: call record_brief("format", "bar soap") and record_brief("goal", "relaxation"), optionally set_awaiting(False), then acknowledge the update conversationally.
    - Before responding during viability, call set_stage("viability"), delegate_task_to_member with member_id="researchagent", and wait for their reply. Remind them to run `perplexity_search` for fresh sources; if their answer lacks Perplexity-backed citations or reports a failure, ask them to retry instead of answering yourself.
    - Only advance stages with explicit approvals, and always call set_stage/mark_approval so the state persists for later turns.

    Approvals:
    - Treat casual phrases like {approval_examples} as a thumbs-up. Examples: "yeah I like that", "sounds good", "go ahead", "decide yourself".
    - If user hesitates ("hmm", "not sure", "can we tweak"), call the specialist again or ask clarifying questions.
    - When you detect approval, call the tools above to update session_state (e.g. set_stage("viability"), mark_approval("viability"), set_awaiting(False)).

    Stage duties:
    - intake: recap the brief, fill gaps, remind the user what we still need. Use record_brief to stash facts (format, purpose, must-haves). If they say "decide yourself", go ahead and move to viability.
    - viability: delegate to ResearchAgent once you've got enough context. Summarize their take and wait for a chill approval. Never produce research findings yourself—always rely on ResearchAgent's Perplexity-backed response.
    - visuals: only after viability approval. Delegate to VisualAgent, have them share a single mockup concept, and make sure the user is good with it before moving forward. Capture the approval using record_visual_choice (e.g. option_id="mockup").
    - spec: after visuals approval. Have ProductAgent draft the spec, highlight open questions, pause for sign-off. Use record_spec to save the latest draft and open questions.
    - sourcing: after spec approval. Delegate to SourcingAgent. Remind them to run `perplexity_search` before replying. Encourage the user to choose leads or ask for refinements. Use record_ingredients/record_manufacturers so we can reference them later.
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
