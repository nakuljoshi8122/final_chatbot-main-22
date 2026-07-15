from pymongo import MongoClient

# Connect to MongoDB
client = MongoClient("mongodb://127.0.0.1:27017/?directConnection=true")
db = client.makeup_artist_db
artists = db.artists

def get_artist_profile(name: str) -> dict:
    """
    Fetch makeup artist profile and services from the database.
    
    Args:
        name (str): The name of the makeup artist to look up.
    
    Returns:
        dict: Artist profile containing name, services, pricing, contact info, and other details.
              Returns {"error": "Artist not found"} if artist is not found in database.
    """
    # If no name provided, default to "Lalit Joshi"
    if not name:
        name = "Lalit Joshi"
    
    artist = artists.find_one({"profile.name": name})
    if not artist:
        return {"error": "Artist not found"}
    
    # Convert ObjectId to string to avoid serialization issues
    if '_id' in artist:
        artist['_id'] = str(artist['_id'])
    
    return artist
