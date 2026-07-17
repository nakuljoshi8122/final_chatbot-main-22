"""Compatibility entrypoint for uvicorn main:app."""
from api.app import app

__all__ = ["app"]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
