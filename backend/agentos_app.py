"""Run the product innovation team inside an AgentOS FastAPI app.

Usage:
    # Install dependencies and set PERPLEXITY_API_KEY first
    pip install agno fastapi[standard] uvicorn
    export PERPLEXITY_API_KEY=sk-...

    python agentos_app.py

Then open http://localhost:7777 to interact with the OS.
"""

from agno.os import AgentOS

from team import innovation_team


agent_os = AgentOS(
    id="product-innovation-os",
    description="AgentOS exposing the Product Innovation Team workflow.",
    teams=[innovation_team],
)

# FastAPI application served by AgentOS.
app = agent_os.get_app()


if __name__ == "__main__":
    agent_os.serve(app="agentos_app:app")
