from pymongo import MongoClient

# Connect to MongoDB
client = MongoClient("mongodb://127.0.0.1:27017/?directConnection=true")
db = client.makeup_artist_db
artists = db.artists

# Artist profile
artist_profile = {
    "name": "Lalit Joshi",
    "profession": "Professional Makeup & Hairstyle Artist",
    "experience": "8+ years in bridal, party, and editorial makeup",
    "location": "Mumbai, India",
    "style": "Modern glam, natural bridal looks, creative editorial styling"
}

# Services
services = {
    "bridalmakeup": {
        "name": "Bridal Makeup",
        "description": "Full bridal glam look, HD makeup, hairstyle, draping",
        "price": "₹18,000",
        "duration": "3-4 hours",
        "includes": ["HD makeup", "Hairstyling", "Saree draping", "Touch-up kit"]
    },
    "engagement": {
        "name": "Engagement / Reception Look",
        "description": "Soft glam with hairstyle & outfit coordination",
        "price": "₹12,000",
        "duration": "2-3 hours",
        "includes": ["Soft glam makeup", "Hairstyling", "Outfit coordination"]
    },
    "partymakeup": {
        "name": "Party Makeup",
        "description": "Quick makeup & styling for parties/events",
        "price": "₹6,000",
        "duration": "1-2 hours",
        "includes": ["Party makeup", "Basic hairstyling"]
    },
    "photoshoot": {
        "name": "Photoshoot / Editorial Makeup",
        "description": "Fashion, magazine, or portfolio shoot makeup & styling",
        "price": "₹15,000",
        "duration": "2-4 hours",
        "includes": ["Editorial makeup", "Multiple looks", "Touch-ups"]
    },
    "hairstyling": {
        "name": "Hairstyling Only",
        "description": "Bridal buns, curls, waves, hair accessories",
        "price": "₹4,000",
        "duration": "1-2 hours",
        "includes": ["Hairstyling", "Hair accessories", "Hair spray"]
    },
    "trial": {
        "name": "Makeup Trial Session",
        "description": "Pre-wedding consultation + trial look",
        "price": "₹3,000",
        "duration": "2-3 hours",
        "includes": ["Consultation", "Trial makeup", "Style discussion"]
    }
}

# Packages
packages = {
    "bridal": {
        "name": "Bridal Premium Package",
        "description": "Bridal Makeup + Hairstyle + Draping",
        "price": "₹22,000"
    },
    "shoot": {
        "name": "Full Day Shoot Package",
        "description": "2–3 looks for photoshoot with touch-ups",
        "price": "₹25,000"
    }
}

# Booking info
booking_info = {
    "advance_booking": "50% payment upfront required",
    "payment_modes": "UPI / Bank Transfer / Cash",
    "availability": "Prior booking recommended (weekends fill fast)",
    "travel": "Extra charges apply for destination weddings"
}

# Portfolio highlights
portfolio = [
    "Styled brides in 50+ weddings across India",
    "Collaborated with fashion photographers for editorial shoots",
    "Known for creating natural yet glamorous bridal looks"
]

# Combine everything into a single document
artist_document = {
    "profile": artist_profile,
    "services": services,
    "packages": packages,
    "booking_info": booking_info,
    "portfolio": portfolio
}

# Insert into MongoDB
artists.insert_one(artist_document)
print("Artist data inserted successfully!")
