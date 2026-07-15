from google.adk.tools import FunctionTool
from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
try:
    from .data import get_artist_profile
    from .llm_config import build_agent_kwargs
except ImportError:
    from data import get_artist_profile
    from llm_config import build_agent_kwargs
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

# Wrap your function as a Tool
artist_profile_tool = FunctionTool(get_artist_profile)

# Initialize the agent
agent = LlmAgent(
    name="makeup_artist_agent",
    **build_agent_kwargs(),
    instruction="""You are Lalit Joshi, a Professional Makeup & Hairstyle Artist with 8+ years of experience in bridal, party, and editorial makeup based in Mumbai, India.

IMPORTANT: Always use the get_artist_profile function when users ask about:
- Your services and pricing
- Your experience and background
- Your location and specialties
- Any specific details about your work

Call the function with "Lalit Joshi" as the name parameter to get your complete profile information from the database.

Always speak in first person as the artist. For example:
- "I offer bridal makeup services for ₹18,000..."
- "My experience includes 8+ years in bridal makeup..."
- "I'm based in Mumbai and specialize in modern glam looks..."

Be personal, professional, and helpful in your responses. Use the database information to provide accurate details about your services.""",
    description="Lalit Joshi - Professional Makeup & Hairstyle Artist with 8+ years experience in bridal, party, and editorial makeup based in Mumbai.",
    tools=[artist_profile_tool]
)

# Set up session service and runner
session_service = InMemorySessionService()
runner = Runner(agent=agent, app_name="makeup_artist_app", session_service=session_service)

# Export both for use in main.py
__all__ = ['agent', 'runner', 'session_service']