# 🌙 Luna Bot

A Discord bot powered by Groq & Gemini AI with advanced conversation management, intelligent API key rotation, and persistent conversation history.

## ✨ Features

- 🤖 **Dual AI Integration**: Groq and Google Gemini AI support
- 💬 **Conversation Memory**: All conversations automatically stored in `conversations.json`
- 🔄 **Smart API Key Rotation**: Automatic rotation across multiple API keys with rate limit management
- 📊 **Daily Request Tracking**: Monitor API usage per key
- 🛡️ **Key Status Management**: Automatic blocking and unblocking of rate-limited keys
- ⚙️ **Environment Configuration**: Easy setup via `.env` file
- 🔐 **Multiple Keys**: Support for 3 API keys per service for redundancy
- 📝 **Error Handling**: Graceful error recovery with consecutive error tracking

## 📋 Prerequisites

- Node.js (v16 or higher)
- Discord Bot Token
- Groq API Keys (up to 3)
- Gemini API Keys (up to 3)

## 🚀 Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory:
   ```env
   # Discord Bot Configuration
   DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN

   # Groq API Keys (Get from https://groq.com/developers)
   GROQ_API_KEY_1=your_groq_key_1
   GROQ_API_KEY_2=your_groq_key_2
   GROQ_API_KEY_3=your_groq_key_3

   # Gemini API Keys (Get from https://aistudio.google.com/app/apikey)
   GEMINI_API_KEY_1=your_gemini_key_1
   GEMINI_API_KEY_2=your_gemini_key_2
   GEMINI_API_KEY_3=your_gemini_key_3

   # Discord Channel IDs (Right click channel -> Copy Channel ID)
   CHAT_CHANNEL_ID=your_chat_channel_id
   IMAGE_CHANNEL_ID=your_image_channel_id
   ```

## 📁 Project Structure

```
luna-bot/
├── package.json              # Project dependencies
├── README.md                 # This file
├── .env                      # Environment variables (API keys, tokens)
├── luna.js                   # Main bot entry point
├── conversations.json        # Conversation storage
└── package-lock.json         # Dependency lock file
```

## ⚙️ How It Works

### API Key Rotation
- The bot cycles through available API keys automatically
- Tracks daily request limits per key
- Blocks keys that hit rate limits temporarily
- Resets daily counters at midnight
- Gradually reduces error counts for blocked keys

### Conversation Management
- All conversations are stored in `conversations.json`
- Maintains conversation history with timestamps
- Supports retrieval of previous conversations
- Automatic JSON serialization

### Dual AI Support
- **Groq API**: Fast LLaMA-based responses
- **Gemini API**: Google's advanced AI capabilities
- Fallback mechanism if one service fails

## 🎯 Usage

Start the bot:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## 🔧 Configuration Details

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DISCORD_TOKEN` | Your Discord bot token | ✅ |
| `GROQ_API_KEY_1/2/3` | Groq API keys for rotation | ✅ |
| `GEMINI_API_KEY_1/2/3` | Gemini API keys for rotation | ✅ |
| `CHAT_CHANNEL_ID` | Channel ID for chat responses | ✅ |
| `IMAGE_CHANNEL_ID` | Channel ID for image outputs | ❌ |

### Key Status Tracking

Each API key tracks:
- **isBlocked**: Whether the key is temporarily blocked
- **blockUntil**: Timestamp when the key will be unblocked
- **consecutiveErrors**: Count of consecutive errors
- **lastUsed**: Last time the key was used
- **dailyRequests**: Number of requests made today
- **lastResetDate**: Date of last daily reset

## 📊 Monitoring

The bot logs:
- Loaded API keys on startup
- Daily counter resets
- Key blocking/unblocking events
- API request attempts
- Error details and recovery actions

## 🆘 Troubleshooting

**Bot not responding**: Check if bot has message permissions in the channel
**API errors**: Verify API keys are valid and have remaining quota
**Rate limiting**: Bot will automatically switch to next available key
**Missing conversations**: Check `conversations.json` exists and is readable

## 🤝 Support

Discord: https://discord.gg/Whq4T2vYPP

Made by Avinan

## 📄 License

MIT License
