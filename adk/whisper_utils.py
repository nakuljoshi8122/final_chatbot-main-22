"""
OpenAI Whisper utilities for speech-to-text functionality.
This module provides functions to convert audio to text using OpenAI's Whisper API.
"""

import os
import tempfile
import base64
from typing import Optional
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def speech_to_text_whisper(audio_file_path: str, language: str = "en") -> str:
    """
    Convert audio file to text using OpenAI Whisper API.
    
    Args:
        audio_file_path: Path to the audio file
        language: Language code for transcription (default: "en")
    
    Returns:
        Transcribed text from the audio file
    """
    try:
        from openai import OpenAI
        
        # Initialize OpenAI client
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.error("OPENAI_API_KEY environment variable not set")
            return "OpenAI API key not configured. Please set OPENAI_API_KEY environment variable."
        
        client = OpenAI(api_key=api_key)
        
        # Open the audio file
        with open(audio_file_path, "rb") as audio_file:
            # Transcribe using Whisper
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                language=language,
                response_format="text"
            )
        
        logger.info(f"Whisper transcription successful: {len(transcript)} characters")
        return transcript.strip()
        
    except ImportError:
        logger.error("OpenAI library not installed. Please install: pip install openai")
        return "OpenAI library not available. Please install the required dependencies."
    except Exception as e:
        logger.error(f"Error in Whisper transcription: {str(e)}")
        return f"I'm having trouble understanding your voice. Please try again. (Error: {str(e)})"

def is_openai_configured() -> bool:
    """
    Check if OpenAI API key is properly configured.
    
    Returns:
        True if API key is configured, False otherwise
    """
    api_key = os.getenv("OPENAI_API_KEY")
    return api_key is not None and len(api_key.strip()) > 0

def get_audio_info(audio_file_path: str) -> dict:
    """
    Get basic information about an audio file.
    
    Args:
        audio_file_path: Path to the audio file
    
    Returns:
        Dictionary with audio file information
    """
    try:
        import os
        stat = os.stat(audio_file_path)
        return {
            "size": stat.st_size,
            "exists": True,
            "path": audio_file_path
        }
    except Exception as e:
        logger.error(f"Error getting audio info: {str(e)}")
        return {"exists": False, "error": str(e)}

def text_to_speech_whisper(text: str, voice: str = "alloy") -> str:
    """
    Convert text to speech using OpenAI TTS API.
    
    Args:
        text: Text to convert to speech
        voice: Voice to use (alloy, echo, fable, onyx, nova, shimmer)
    
    Returns:
        Base64 encoded audio data
    """
    try:
        from openai import OpenAI
        
        # Initialize OpenAI client
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.error("OPENAI_API_KEY environment variable not set")
            return None
        
        client = OpenAI(api_key=api_key)
        
        # Generate speech with higher quality model for better volume
        response = client.audio.speech.create(
            model="tts-1-hd",  # Higher quality model
            voice=voice,
            input=text,
            response_format="mp3"  # Ensure consistent format
        )
        
        # Convert to base64
        audio_data = response.content
        audio_base64 = base64.b64encode(audio_data).decode('utf-8')
        
        logger.info(f"TTS generation successful: {len(text)} characters -> {len(audio_base64)} bytes")
        return audio_base64
        
    except ImportError:
        logger.error("OpenAI library not installed. Please install: pip install openai")
        return None
    except Exception as e:
        logger.error(f"Error in TTS generation: {str(e)}")
        return None

def test_whisper_connection() -> bool:
    """
    Test if Whisper API is working correctly.
    
    Returns:
        True if connection is successful, False otherwise
    """
    try:
        from openai import OpenAI
        
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            return False
        
        client = OpenAI(api_key=api_key)
        
        # Test with a simple API call (list models)
        models = client.models.list()
        return True
        
    except Exception as e:
        logger.error(f"Whisper connection test failed: {str(e)}")
        return False
