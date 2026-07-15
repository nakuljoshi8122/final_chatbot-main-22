# Makeup Artist Chatbot App

A React Native mobile app for Lalit Joshi's makeup artistry business, featuring an AI-powered chatbot and service showcase.

## Features

- **AI Chatbot**: Interactive chat with Lalit Joshi's AI assistant powered by Google's ADK
- **Services Showcase**: Complete pricing and service information
- **Profile Page**: About Lalit, contact information, and portfolio highlights
- **Session Management**: Persistent chat sessions for continuous conversations
- **Responsive Design**: Works on iOS, Android, and Web
- **Dark/Light Mode**: Automatic theme switching based on system preferences

## Tech Stack

- **Frontend**: React Native with Expo
- **Backend**: FastAPI with Google ADK (Agent Development Kit)
- **Database**: MongoDB
- **AI**: Google Gemini 2.0 Flash model

## Prerequisites

1. **Backend Setup**: Make sure your FastAPI backend is running on `http://localhost:8000`
2. **MongoDB**: Ensure MongoDB is running locally
3. **Node.js**: Version 18 or higher
4. **Expo CLI**: Install globally with `npm install -g @expo/cli`

## Installation

1. Install dependencies:
```bash
cd botbotbot
npm install
```

2. Start the development server:
```bash
npm start
```

3. Run on your preferred platform:
- **iOS**: Press `i` in the terminal or run `npm run ios`
- **Android**: Press `a` in the terminal or run `npm run android`
- **Web**: Press `w` in the terminal or run `npm run web`

## Backend Integration

The app communicates with your FastAPI backend through the `/ask` endpoint:

- **Endpoint**: `POST http://localhost:8000/ask`
- **Request Body**: `{ "query": "user message", "session_id": "optional" }`
- **Response**: `{ "answer": "bot response", "session_id": "session_id" }`

## App Structure

```
botbotbot/
├── app/
│   ├── (tabs)/
│   │   ├── index.tsx      # Chat interface
│   │   ├── explore.tsx    # Services showcase
│   │   └── profile.tsx    # About Lalit
│   └── _layout.tsx        # Root layout
├── components/
│   ├── ChatInterface.tsx  # Main chat component
│   └── ServicesShowcase.tsx # Services display
├── services/
│   └── api.ts            # API service layer
└── package.json
```

## Key Components

### ChatInterface
- Real-time chat with the AI assistant
- Message history with timestamps
- Loading states and error handling
- Session management for conversation continuity

### ServicesShowcase
- Complete service catalog with pricing
- Package deals and special offers
- Booking information and policies
- Interactive service cards

### Profile Page
- Artist information and experience
- Portfolio highlights
- Contact methods (phone, email, Instagram)
- Professional details

## Customization

### API Configuration
Update the API base URL in `services/api.ts`:
```typescript
const API_BASE_URL = 'http://your-backend-url:8000';
```

### Styling
The app uses a theming system with light/dark mode support. Colors are defined in `constants/Colors.ts`.

### Services Data
Service information is hardcoded in `components/ServicesShowcase.tsx`. You can modify the `services` array to update pricing or add new services.

## Troubleshooting

### Backend Connection Issues
- Ensure your FastAPI backend is running on port 8000
- Check that MongoDB is running and accessible
- Verify the API endpoint is responding correctly

### Mobile Development
- For iOS: Make sure you have Xcode installed
- For Android: Ensure Android Studio and SDK are set up
- For Web: The app should work in any modern browser

### Common Issues
- **Metro bundler issues**: Try clearing cache with `npx expo start --clear`
- **Dependency conflicts**: Delete `node_modules` and run `npm install` again
- **Port conflicts**: Make sure port 8081 (Expo) and 8000 (backend) are available

## Development

### Adding New Features
1. Create components in the `components/` directory
2. Add new screens in `app/(tabs)/` for new tabs
3. Update the tab layout in `app/(tabs)/_layout.tsx`
4. Use the existing theming system for consistent styling

### API Integration
- All API calls go through `services/api.ts`
- Use the existing `apiService` for consistency
- Handle errors gracefully with user-friendly messages

## Production Build

To create a production build:

```bash
# For iOS
npx expo build:ios

# For Android
npx expo build:android

# For Web
npx expo build:web
```

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the Expo documentation
3. Ensure your backend is properly configured
4. Check the console for error messages

---

**Note**: This app is designed to work with the specific FastAPI backend structure in the `adk/` directory. Make sure your backend is running and properly configured before testing the app.