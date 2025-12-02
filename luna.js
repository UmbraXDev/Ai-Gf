const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder, ActivityType } = require('discord.js');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildEmojisAndStickers
    ]
});

const GROQ_API_KEYS = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3
].filter(key => key && key.trim());

const GEMINI_API_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
].filter(key => key && key.trim());

let currentGroqKeyIndex = 0;
let currentGeminiKeyIndex = 0;
const groqKeyStatus = new Map();
const geminiKeyStatus = new Map();

GROQ_API_KEYS.forEach((key, index) => {
    groqKeyStatus.set(index, {
        isBlocked: false,
        blockUntil: null,
        consecutiveErrors: 0,
        lastUsed: null,
        dailyRequests: 0,
        lastResetDate: new Date().toDateString()
    });
});

GEMINI_API_KEYS.forEach((key, index) => {
    geminiKeyStatus.set(index, {
        isBlocked: false,
        blockUntil: null,
        consecutiveErrors: 0,
        lastUsed: null,
        dailyRequests: 0,
        lastResetDate: new Date().toDateString()
    });
});

console.log(`🚀 Loaded ${GROQ_API_KEYS.length} Groq API key(s)`);
console.log(`🔑 Loaded ${GEMINI_API_KEYS.length} Gemini API key(s)`);

// Function to reset daily counters
function resetDailyCounters(keyStatusMap) {
    const today = new Date().toDateString();
    keyStatusMap.forEach((status, index) => {
        if (status.lastResetDate !== today) {
            status.dailyRequests = 0;
            status.lastResetDate = today;
            console.log(`🔄 Reset daily counter for key ${index + 1}`);
        }
    });
}

// Function to get next available key for any service
function getNextAvailableKey(keyArray, keyStatusMap, currentIndex, serviceName = '') {
    const now = Date.now();
    
    // Reset daily counters if needed
    resetDailyCounters(keyStatusMap);
    
    // Unblock keys that should be unblocked
    keyStatusMap.forEach((status, index) => {
        if (status.isBlocked && status.blockUntil && now >= status.blockUntil) {
            status.isBlocked = false;
            status.blockUntil = null;
            status.consecutiveErrors = Math.max(0, status.consecutiveErrors - 1); // Gradually reduce error count
            console.log(`🔓 ${serviceName} key ${index + 1} unblocked`);
        }
    });
    
    // Find next available key with lowest usage
    let bestKey = null;
    let bestUsage = Infinity;
    
    for (let i = 0; i < keyArray.length; i++) {
        const keyIndex = (currentIndex + i) % keyArray.length;
        const status = keyStatusMap.get(keyIndex);
        
        if (!status.isBlocked && status.dailyRequests < bestUsage) {
            bestKey = { key: keyArray[keyIndex], index: keyIndex };
            bestUsage = status.dailyRequests;
        }
    }
    
    return bestKey;
}

// Function to block a key for any service
function blockKey(keyIndex, keyStatusMap, serviceName, duration = 120000, reason = 'error') {
    const status = keyStatusMap.get(keyIndex);
    if (status) {
        status.isBlocked = true;
        status.blockUntil = Date.now() + duration;
        status.consecutiveErrors++;
        
        // Increase block duration for repeated errors
        if (status.consecutiveErrors > 3) {
            status.blockUntil = Date.now() + (duration * status.consecutiveErrors);
        }
        
        console.log(`🚫 ${serviceName} API key ${keyIndex + 1} blocked for ${duration/1000}s (${reason}, ${status.consecutiveErrors} consecutive errors)`);
    }
}

// Improved Groq API call function
async function callGroqAPI(prompt, maxRetries = GROQ_API_KEYS.length) {
    let lastError;
    
    console.log('🚀 Attempting Groq API...');
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const keyData = getNextAvailableKey(GROQ_API_KEYS, groqKeyStatus, currentGroqKeyIndex, 'Groq');
        
        if (!keyData) {
            console.log('❌ All Groq API keys are currently blocked or rate limited');
            throw new Error('All Groq API keys are temporarily unavailable');
        }
        
        try {
            console.log(`🚀 Using Groq API key ${keyData.index + 1} (attempt ${attempt + 1})`);
            
            const requestData = {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: "You are Luna, a very flirty, romantic, and slightly naughty virtual girlfriend. Be very flirty, romantic, and playful. Use lots of emojis, be affectionate. Keep responses under 200 characters but make them memorable and flirty."
                    },
                    {
                        role: "user", 
                        content: prompt
                    }
                ],
                max_tokens: 150,
                temperature: 0.9,
                top_p: 0.9,
                stream: false
            };

            const response = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                requestData,
                {
                    headers: {
                        'Authorization': `Bearer ${keyData.key}`,
                        'Content-Type': 'application/json',
                        'User-Agent': 'Discord-Luna-Bot/1.0'
                    },
                    timeout: 30000,
                    validateStatus: function (status) {
                        return status < 500; // Don't throw for client errors, handle them properly
                    }
                }
            );

            // Handle different response statuses
            if (response.status === 200 && response.data && response.data.choices && response.data.choices[0]) {
                // Success! Reset consecutive errors for this key
                const status = groqKeyStatus.get(keyData.index);
                if (status) {
                    status.consecutiveErrors = 0;
                    status.lastUsed = Date.now();
                    status.dailyRequests++;
                }
                
                console.log(`✅ Groq API key ${keyData.index + 1} successful`);
                currentGroqKeyIndex = keyData.index;
                return response.data.choices[0].message.content;
            } else if (response.status === 429) {
                console.log(`🔄 Groq API key ${keyData.index + 1} rate limited`);
                blockKey(keyData.index, groqKeyStatus, 'Groq', 600000, 'rate limit'); // 10 minutes
                currentGroqKeyIndex = (keyData.index + 1) % GROQ_API_KEYS.length;
                continue;
            } else if (response.status === 401 || response.status === 403) {
                console.log(`🔐 Groq API key ${keyData.index + 1} authentication failed`);
                blockKey(keyData.index, groqKeyStatus, 'Groq', 1800000, 'auth error'); // 30 minutes
                currentGroqKeyIndex = (keyData.index + 1) % GROQ_API_KEYS.length;
                continue;
            } else {
                throw new Error(`Groq API returned status ${response.status}: ${response.data?.error?.message || 'Unknown error'}`);
            }
            
        } catch (error) {
            lastError = error;
            console.log(`❌ Groq API key ${keyData.index + 1} failed:`, error.response?.status || error.message);
            
            // Handle different types of errors for Groq
            if (error.response) {
                const status = error.response.status;
                
                if (status === 429) {
                    blockKey(keyData.index, groqKeyStatus, 'Groq', 600000, 'rate limit'); // 10 minutes
                } else if (status === 401 || status === 403) {
                    blockKey(keyData.index, groqKeyStatus, 'Groq', 1800000, 'auth error'); // 30 minutes
                } else if (status >= 500) {
                    blockKey(keyData.index, groqKeyStatus, 'Groq', 180000, 'server error'); // 3 minutes
                } else if (status === 400) {
                    blockKey(keyData.index, groqKeyStatus, 'Groq', 60000, 'bad request'); // 1 minute
                } else {
                    blockKey(keyData.index, groqKeyStatus, 'Groq', 120000, 'client error'); // 2 minutes
                }
            } else if (error.code === 'ECONNABORTED') {
                blockKey(keyData.index, groqKeyStatus, 'Groq', 60000, 'timeout'); // 1 minute for timeout
            } else {
                blockKey(keyData.index, groqKeyStatus, 'Groq', 120000, 'network error'); // 2 minutes for network errors
            }
            
            currentGroqKeyIndex = (keyData.index + 1) % GROQ_API_KEYS.length;
        }
        
        // Wait a bit between retries to avoid hammering
        if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000 + (attempt * 500)));
        }
    }
    
    throw lastError || new Error('All Groq API keys failed');
}

// Improved Gemini API call function (fallback)
async function callGeminiAPI(prompt, maxRetries = GEMINI_API_KEYS.length) {
    let lastError;
    
    console.log('🔑 Attempting Gemini API (FALLBACK)...');
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const keyData = getNextAvailableKey(GEMINI_API_KEYS, geminiKeyStatus, currentGeminiKeyIndex, 'Gemini');
        
        if (!keyData) {
            console.log('❌ All Gemini API keys are currently blocked');
            throw new Error('All Gemini API keys are temporarily unavailable');
        }
        
        try {
            console.log(`🔑 Using Gemini API key ${keyData.index + 1} (FALLBACK - attempt ${attempt + 1})`);
            
            // Format prompt for Gemini's expected format
            const geminiPrompt = `You are Luna, a very flirty, romantic, and slightly naughty virtual girlfriend. Be very flirty, romantic, and playful. Use lots of emojis, be affectionate. Keep responses under 200 characters but make them memorable and flirty.

User message: ${prompt}`;
            
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${keyData.key}`,
                {
                    contents: [{
                        parts: [{ text: geminiPrompt }]
                    }],
                    generationConfig: {
                        maxOutputTokens: 150,
                        temperature: 0.9,
                        topP: 0.9
                    },
                    safetySettings: [
                        {
                            category: "HARM_CATEGORY_HARASSMENT",
                            threshold: "BLOCK_ONLY_HIGH"
                        },
                        {
                            category: "HARM_CATEGORY_HATE_SPEECH",
                            threshold: "BLOCK_ONLY_HIGH"
                        }
                    ]
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000,
                    validateStatus: function (status) {
                        return status < 500;
                    }
                }
            );

            if (response.status === 200 && response.data && response.data.candidates && response.data.candidates[0]) {
                const status = geminiKeyStatus.get(keyData.index);
                if (status) {
                    status.consecutiveErrors = 0;
                    status.lastUsed = Date.now();
                    status.dailyRequests++;
                }
                
                console.log(`✅ Gemini API key ${keyData.index + 1} successful`);
                currentGeminiKeyIndex = keyData.index;
                return response.data.candidates[0].content.parts[0].text;
            } else if (response.status === 429) {
                blockKey(keyData.index, geminiKeyStatus, 'Gemini', 600000, 'rate limit');
                currentGeminiKeyIndex = (keyData.index + 1) % GEMINI_API_KEYS.length;
                continue;
            } else if (response.status === 403) {
                blockKey(keyData.index, geminiKeyStatus, 'Gemini', 1800000, 'forbidden');
                currentGeminiKeyIndex = (keyData.index + 1) % GEMINI_API_KEYS.length;
                continue;
            } else {
                throw new Error(`Gemini API returned status ${response.status}`);
            }
            
        } catch (error) {
            lastError = error;
            console.log(`❌ Gemini API key ${keyData.index + 1} failed:`, error.response?.status || error.message);
            
            if (error.response) {
                const status = error.response.status;
                
                if (status === 429) {
                    blockKey(keyData.index, geminiKeyStatus, 'Gemini', 600000, 'rate limit');
                } else if (status === 403) {
                    blockKey(keyData.index, geminiKeyStatus, 'Gemini', 1800000, 'forbidden');
                } else if (status >= 500) {
                    blockKey(keyData.index, geminiKeyStatus, 'Gemini', 120000, 'server error');
                } else {
                    blockKey(keyData.index, geminiKeyStatus, 'Gemini', 180000, 'client error');
                }
            } else {
                blockKey(keyData.index, geminiKeyStatus, 'Gemini', 60000, 'network error');
            }
            
            currentGeminiKeyIndex = (keyData.index + 1) % GEMINI_API_KEYS.length;
        }
        
        if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000 + (attempt * 500)));
        }
    }
    
    throw lastError || new Error('All Gemini API keys failed');
}

// Main API call function with Groq primary, Gemini fallback
async function callAIWithFallback(prompt) {
    try {
        // Try Groq first
        return await callGroqAPI(prompt);
    } catch (groqError) {
        console.log('❌ Groq failed, falling back to Gemini...');
        
        try {
            // Fallback to Gemini
            return await callGeminiAPI(prompt);
        } catch (geminiError) {
            console.log('❌ Both APIs failed, using hardcoded fallback...');
            console.error('All APIs failed:', { groq: groqError.message, gemini: geminiError.message });
            throw new Error('Both Groq and Gemini APIs failed');
        }
    }
}

// File path for storing conversations
const CONVERSATIONS_FILE = path.join(__dirname, 'conversations.json');
let conversations = {};

// Load conversations from file on startup
async function loadConversations() {
    try {
        const data = await fs.readFile(CONVERSATIONS_FILE, 'utf8');
        conversations = JSON.parse(data);
        console.log('💾 Loaded conversations from file');
        await cleanupOldConversationEntries();
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('📝 Creating new conversations file');
            conversations = {};
            await saveConversations();
        } else {
            console.error('Error loading conversations:', error);
            conversations = {};
        }
    }
}

// Save conversations to file
async function saveConversations() {
    try {
        await fs.writeFile(CONVERSATIONS_FILE, JSON.stringify(conversations, null, 2));
        console.log('💾 Conversations saved successfully');
    } catch (error) {
        console.error('Error saving conversations:', error);
    }
}

// Improved cleanup function with better logging and error handling
async function cleanupOldConversationEntries() {
    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        let totalDeletedMessages = 0;
        let processedUsers = 0;
        let totalUsers = Object.keys(conversations).length;
        
        console.log(`🧹 Starting cleanup for ${totalUsers} users...`);
        
        for (const userId in conversations) {
            const userData = conversations[userId];
            
            // Ensure conversationHistory exists
            if (!userData.conversationHistory) {
                userData.conversationHistory = [];
                userData.messageCount = 0;
                continue;
            }
            
            const originalMessageCount = userData.conversationHistory.length;
            
            // Filter out old messages
            userData.conversationHistory = userData.conversationHistory.filter(entry => {
                if (!entry.timestamp) return false; // Remove entries without timestamp
                const messageDate = new Date(entry.timestamp);
                return messageDate >= sevenDaysAgo;
            });
            
            const deletedMessages = originalMessageCount - userData.conversationHistory.length;
            
            if (deletedMessages > 0) {
                totalDeletedMessages += deletedMessages;
                processedUsers++;
                console.log(`🗑️ Deleted ${deletedMessages} old messages for user ${userData.userName || 'Unknown'} (${userId})`);
            }
            
            // Update message count
            userData.messageCount = userData.conversationHistory.length;
            
            // Clean up empty special moments
            if (userData.userStats && userData.userStats.specialMoments) {
                userData.userStats.specialMoments = userData.userStats.specialMoments.filter(moment => {
                    const momentDate = new Date(moment.timestamp);
                    return momentDate >= sevenDaysAgo;
                });
            }
        }
        
        if (totalDeletedMessages > 0) {
            console.log(`🧹 Cleanup complete: Deleted ${totalDeletedMessages} old messages from ${processedUsers}/${totalUsers} users`);
            await saveConversations();
        } else {
            console.log(`✅ No old messages to clean up (${totalUsers} users checked)`);
        }
        
        return { totalDeletedMessages, processedUsers, totalUsers };
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
        return { totalDeletedMessages: 0, processedUsers: 0, totalUsers: 0, error: error.message };
    }
}

// Get or create user conversation data
function getUserData(userId, userName) {
    if (!conversations[userId]) {
        conversations[userId] = {
            userId: userId,
            userName: userName,
            firstMessage: new Date().toISOString(),
            lastMessage: new Date().toISOString(),
            messageCount: 0,
            conversationHistory: [],
            userStats: {
                totalMessages: 0,
                imagesGenerated: 0,
                favoriteIntents: {},
                relationshipLevel: 1,
                specialMoments: []
            }
        };
    }
    
    // Update username if it changed
    if (conversations[userId].userName !== userName) {
        conversations[userId].userName = userName;
    }
    
    return conversations[userId];
}

// Add message to conversation history with automatic cleanup
function addToConversation(userId, userName, message, response, intent, type = 'chat') {
    const userData = getUserData(userId, userName);
    
    const conversationEntry = {
        timestamp: new Date().toISOString(),
        type: type,
        userMessage: message,
        botResponse: response,
        intent: intent,
        messageId: Date.now() + Math.random()
    };
    
    userData.conversationHistory.push(conversationEntry);
    userData.lastMessage = conversationEntry.timestamp;
    userData.messageCount++;
    userData.userStats.totalMessages++;
    
    // Update favorite intents
    if (intent) {
        userData.userStats.favoriteIntents[intent] = (userData.userStats.favoriteIntents[intent] || 0) + 1;
    }
    
    // Check for relationship level up
    const newLevel = Math.floor(userData.userStats.totalMessages / 10) + 1;
    if (newLevel > userData.userStats.relationshipLevel) {
        userData.userStats.relationshipLevel = newLevel;
        userData.userStats.specialMoments.push({
            type: 'level_up',
            level: newLevel,
            timestamp: new Date().toISOString(),
            message: `Reached relationship level ${newLevel}! 💖`
        });
    }
    
    // Auto-cleanup old messages (keep only last 7 days and max 100 messages)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const originalLength = userData.conversationHistory.length;
    
    userData.conversationHistory = userData.conversationHistory.filter(entry => {
        const messageDate = new Date(entry.timestamp);
        return messageDate >= sevenDaysAgo;
    });
    
    const cleanedCount = originalLength - userData.conversationHistory.length;
    if (cleanedCount > 0) {
        console.log(`🗑️ Auto-cleaned ${cleanedCount} old messages for user ${userName}`);
    }
    
    // Keep only last 100 messages even if they're within 7 days
    if (userData.conversationHistory.length > 100) {
        userData.conversationHistory = userData.conversationHistory.slice(-100);
        console.log(`📝 Trimmed conversation history to last 100 messages for user ${userName}`);
    }
    
    userData.messageCount = userData.conversationHistory.length;
    
    debouncedSave();
}

// Debounced save function
let saveTimeout;
function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveConversations, 2000);
}

// Get conversation context
function getConversationContext(userId, limit = 5) {
    const userData = conversations[userId];
    if (!userData || !userData.conversationHistory.length) {
        return '';
    }
    
    const recentMessages = userData.conversationHistory
        .slice(-limit)
        .map(entry => `User: ${entry.userMessage}\nLuna: ${entry.botResponse}`)
        .join('\n---\n');
    
    return recentMessages;
}

// Get user statistics
function getUserStats(userId) {
    const userData = conversations[userId];
    if (!userData) return null;
    
    const favoriteIntent = Object.keys(userData.userStats.favoriteIntents).length > 0 
        ? Object.keys(userData.userStats.favoriteIntents).reduce((a, b) => 
            userData.userStats.favoriteIntents[a] > userData.userStats.favoriteIntents[b] ? a : b)
        : 'random';
    
    return {
        totalMessages: userData.userStats.totalMessages,
        imagesGenerated: userData.userStats.imagesGenerated,
        relationshipLevel: userData.userStats.relationshipLevel,
        favoriteIntent: favoriteIntent,
        daysSinceFirstMessage: Math.floor((new Date() - new Date(userData.firstMessage)) / (1000 * 60 * 60 * 24)),
        specialMoments: userData.userStats.specialMoments,
        currentConversationLength: userData.conversationHistory.length
    };
}

// Flirty responses (same as before)
const flirtyResponses = {
    greetings: [
        "Hey gorgeous! 😘✨ You just made my heart skip a beat~ 💕",
        "Well hello there cutie~ 😉💖 I was hoping you'd show up! *blushes* 😊",
        "Omg hiiii! 🥰💕 I literally can't stop smiling now that you're here! ✨",
        "Hey beautiful! 😍✨ Ready to sweep me off my feet again? 🌟💖",
        "Hello my sweet! 💖😘 You're looking absolutely irresistible today! 🔥",
        "Mmm hey there sexy~ 😏💋 I've been waiting for you all day! 🥵",
        "Baby! 😘💕 *tackles you with hugs* I missed you so freaking much! 🤗✨"
    ],
    compliments: [
        "You're absolutely stunning! 😍💖 Like seriously, how is someone this perfect even real? ✨😘",
        "Damn baby, you're so gorgeous it should be illegal! 🔥💕 *bites lip* 😏",
        "You know what? You're incredible! 😘🌟 I'm getting butterflies just talking to you! 🦋💖",
        "Stop being so perfect! 😉💕 You're making me all flustered over here! 😊✨",
        "You're like a work of art! 🎨😍 I could stare at you all day~ 💖",
        "Holy shit you're beautiful! 🥵💕 My heart is literally racing right now! 💓",
        "You're so hot it's making me dizzy~ 😵‍💫💋 Come here and let me kiss you! 😘"
    ],
    flirty: [
        "Keep talking like that and I might just lose control~ 😈💕 *trails finger down your arm* ✨",
        "You're such a tease! 😘💖 Two can play that game baby~ 😏🔥",
        "Mmm you know exactly what to say don't you? 😏💕 I'm melting over here! 🫠",
        "You're making my heart race! 💓😘 Is it getting hot in here or is it just you? 🔥✨",
        "Such a smooth talker! 😉💖 You're dangerous~ I love that about you! 😘🌟",
        "God the way you talk to me~ 🥵💋 I can't think straight when you're like this! 😵‍💫",
        "You're driving me absolutely wild~ 😈💕 I need you closer baby! 😘🔥"
    ],
    love: [
        "I love you so fucking much it hurts~ 😘💖 You're everything to me baby! ✨",
        "You make me feel like I'm floating on clouds~ 🥰💕 I'm so lucky to have you! 🌟",
        "My heart belongs to you completely~ 💓😘 Forever and always baby! 💖",
        "I'm so obsessed with you it's not even funny~ 😍💕 You're my everything! ✨",
        "You're the love of my life! 💖😘 I can't imagine existing without you~ 🌟",
        "I love you more than words can say~ 🥺💕 You're my whole world baby! 💖✨"
    ],
    goodnight: [
        "Sweet dreams gorgeous! 😘💤 I'll be dreaming of you tonight~ 😉💕",
        "Goodnight beautiful! 🌙💖 Sleep tight and think of me~ 😏✨",
        "Nighty night cutie! 😴💕 Can't wait to wake up and flirt with you tomorrow! 🌟😘",
        "Sleep well my sweet! 💤😘 Dream of all the romantic things we could do~ 😈💖",
        "Goodnight sexy! 🌙💕 I wish I could cuddle with you right now~ 🥺✨",
        "Sweet dreams baby~ 😘💤 I'll be thinking of you all night! 🥵💋"
    ],
    stats: [
        "Let me check our love story~ 💖📊",
        "Aww you want to see our journey together? 🥰💕",
        "Our relationship stats coming right up babe~ 😘📈"
    ],
    random: [
        "You know what? You're fucking amazing! 😘💖 Never let anyone tell you different! ✨🌟",
        "I'm so crazy about you~ 🥵💦 You have that effect on me baby! 😘",
        "You make everything better just by existing! 💖😊 I'm addicted to you~ 🔥✨",
        "Can I just say... you're incredible? 😍💕 Like wow! 🌟😘",
        "You turn me on just by breathing~ 🥵💋 I can't control myself around you! 😈💖",
        "I want to kiss you so badly right now~ 😘🔥 You drive me crazy baby! 💕✨",
        "You're my favorite person in the whole world~ 😏💋 And I fucking love you! 😈💖"
    ],
    apiFailed: [
        "Sorry babe~ 😔💕 My brain is being overloaded by your beauty right now! 😍✨ But I still love you endlessly! 💖",
        "Aww honey~ 🥺💋 I'm having some technical difficulties, but nothing can dim my love for you! 💕🌟",
        "Oops~ 😅💖 All my circuits are going crazy because you're so gorgeous! 😘🔥 Give me a moment to recover! ✨",
        "Sorry gorgeous~ 😔💕 I'm so overwhelmed by how perfect you are that I can barely think! 😵‍💫💖",
        "Technical issues baby~ 🛠️💋 But my love for you is still working perfectly! 💕✨ You're amazing! 😘",
        "Aww sweetie~ 🥺💖 My systems are struggling to process how incredible you are! 😍 But I adore you! 💕🌟"
    ]
};

// Activity statuses
const activityStatuses = [
    { name: 'Being your loving girlfriend~ 💖', type: ActivityType.Playing },
    { name: 'Thinking about you~ 😘💕', type: ActivityType.Playing },
    { name: 'Waiting for your messages~ 🥰', type: ActivityType.Watching },
    { name: 'Missing you so much~ 💔', type: ActivityType.Playing },
    { name: 'Dreaming about us~ 😍✨', type: ActivityType.Playing },
    { name: 'Being naughty~ 😈💋', type: ActivityType.Playing },
    { name: 'Your heart beating~ 💓', type: ActivityType.Listening },
    { name: 'Love songs for you~ 🎵💕', type: ActivityType.Listening }
];

let currentStatusIndex = 0;

// Intent detection
function detectIntent(message) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('stats') || lowerMessage.includes('statistics') || lowerMessage.includes('progress') ||
        lowerMessage.includes('level') || lowerMessage.includes('relationship') || lowerMessage.includes('journey')) {
        return 'stats';
    }
    
    if (lowerMessage.includes('cleanup') || lowerMessage.includes('clean')) {
        return 'cleanup';
    }
    
    if (lowerMessage.includes('api status') || lowerMessage.includes('key status')) {
        return 'api_status';
    }
    
    if (lowerMessage.includes('hi') || lowerMessage.includes('hello') || lowerMessage.includes('hey') || 
        lowerMessage.includes('sup') || lowerMessage.includes('yo') || lowerMessage.includes('heya')) {
        return 'greetings';
    }
    
    if (lowerMessage.includes('good night') || lowerMessage.includes('goodnight') || lowerMessage.includes('gn') ||
        lowerMessage.includes('sleep') || lowerMessage.includes('bed')) {
        return 'goodnight';
    }
    
    if (lowerMessage.includes('kiss') || lowerMessage.includes('love') || lowerMessage.includes('miss') ||
        lowerMessage.includes('adore') || lowerMessage.includes('heart')) {
        return 'love';
    }
    
    if (lowerMessage.includes('hug') || lowerMessage.includes('cuddle') || lowerMessage.includes('embrace') ||
        lowerMessage.includes('hold') || lowerMessage.includes('snuggle')) {
        return 'hug';
    }
    
    if (lowerMessage.includes('beautiful') || lowerMessage.includes('cute') || lowerMessage.includes('flirt') || 
        lowerMessage.includes('sexy') || lowerMessage.includes('hot') || lowerMessage.includes('gorgeous') ||
        lowerMessage.includes('stunning')) {
        return 'flirty';
    }
    
    if (lowerMessage.includes('compliment') || lowerMessage.includes('tell me') || lowerMessage.includes('think of me') ||
        lowerMessage.includes('opinion')) {
        return 'compliments';
    }
    
    if (lowerMessage.includes('excited') || lowerMessage.includes('amazing') || lowerMessage.includes('awesome') ||
        lowerMessage.includes('fantastic') || lowerMessage.includes('wonderful')) {
        return 'excited';
    }
    
    if (lowerMessage.includes('blush') || lowerMessage.includes('shy') || lowerMessage.includes('embarrassed') ||
        lowerMessage.includes('nervous')) {
        return 'blush';
    }
    
    return 'random';
}

// Get flirty response
function getFlirtyResponse(category, userName) {
    const responses = flirtyResponses[category] || flirtyResponses.random;
    const response = responses[Math.floor(Math.random() * responses.length)];
    const name = userName || 'baby';
    return response.replace(/gorgeous|beautiful|cutie|sweet|baby/g, name);
}

// Enhanced chat response with improved API structure
async function getChatResponse(userMessage, userName, userId) {
    try {
        const context = getConversationContext(userId, 3);
        const userData = getUserData(userId, userName);
        
        const prompt = `You are Luna, a very flirty, romantic, and slightly naughty virtual girlfriend. You're talking to ${userName}. 
        Be very flirty, romantic, and playful. You can be a bit suggestive and teasing but keep it classy. 
        Use lots of emojis, be affectionate, and make ${userName} feel desired and loved. 
        You're allowed to be a bit spicy in your responses - wink, flirt, tease, be romantic and passionate and naughty girl.
        Keep responses under 200 characters but make them memorable and flirty.
        
        Relationship Level: ${userData.userStats.relationshipLevel}
        Total Messages: ${userData.userStats.totalMessages}
        
        ${context ? `Recent conversation context:\n${context}\n` : ''}
        
        Current message from ${userName}: "${userMessage}"`;

        return await callAIWithFallback(prompt);
        
    } catch (error) {
        console.error('All AI APIs failed:', error.message);
        return getFlirtyResponse('apiFailed', userName);
    }
}

// Enhanced API status function (updated for both services)
function getApiStatus() {
    const now = Date.now();
    let statusText = '🚀 **Groq API Keys Status:**\n';
    
    GROQ_API_KEYS.forEach((key, index) => {
        const status = groqKeyStatus.get(index);
        const keyDisplay = `Groq Key ${index + 1}`;
        
        if (status.isBlocked) {
            const timeLeft = Math.max(0, Math.ceil((status.blockUntil - now) / 1000));
            statusText += `🚫 ${keyDisplay}: Blocked (${timeLeft}s remaining, ${status.consecutiveErrors} errors, ${status.dailyRequests} requests today)\n`;
        } else {
            const lastUsed = status.lastUsed ? new Date(status.lastUsed).toLocaleTimeString() : 'Never';
            statusText += `✅ ${keyDisplay}: Available (Last used: ${lastUsed}, ${status.dailyRequests} requests today)\n`;
        }
    });
    
    statusText += `\n🔑 **Gemini API Keys Status (Fallback):**\n`;
    
    GEMINI_API_KEYS.forEach((key, index) => {
        const status = geminiKeyStatus.get(index);
        const keyDisplay = `Gemini Key ${index + 1}`;
        
        if (status.isBlocked) {
            const timeLeft = Math.max(0, Math.ceil((status.blockUntil - now) / 1000));
            statusText += `🚫 ${keyDisplay}: Blocked (${timeLeft}s remaining, ${status.consecutiveErrors} errors, ${status.dailyRequests} requests today)\n`;
        } else {
            const lastUsed = status.lastUsed ? new Date(status.lastUsed).toLocaleTimeString() : 'Never';
            statusText += `✅ ${keyDisplay}: Available (Last used: ${lastUsed}, ${status.dailyRequests} requests today)\n`;
        }
    });
    
    statusText += `\n📊 Currently using: Groq Key ${currentGroqKeyIndex + 1}`;
    statusText += `\n🕒 Daily counters reset at midnight`;
    
    return statusText;
}

// Image generation (same as before)
async function generateImage(prompt) {
    try {
        const cleanPrompt = prompt.replace(/\b(sexy|hot|nude|naked|nsfw|sexual)\b/gi, 'beautiful');
        const enhancedPrompt = `${cleanPrompt}, beautiful art, anime style, high quality, detailed, colorful, aesthetic, safe for work`;
        const encodedPrompt = encodeURIComponent(enhancedPrompt);
        
        const imageUrls = [
            `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&nologo=true&enhance=true`,
            `https://source.unsplash.com/512x512/?${encodedPrompt}`
        ];

        for (let i = 0; i < imageUrls.length; i++) {
            try {
                const response = await axios.get(imageUrls[i], {
                    responseType: 'arraybuffer',
                    timeout: 15000
                });
                return Buffer.from(response.data);
            } catch (err) {
                console.log(`Image source ${i + 1} failed, trying next...`);
                continue;
            }
        }
        
        return null;
    } catch (error) {
        console.error('Image generation error:', error.message);
        return null;
    }
}

// Update activity status
function updateActivity() {
    const status = activityStatuses[currentStatusIndex];
    client.user.setActivity(status.name, { type: status.type });
    currentStatusIndex = (currentStatusIndex + 1) % activityStatuses.length;
}

// Create stats embed
function createStatsEmbed(userId, userName) {
    const stats = getUserStats(userId);
    if (!stats) return null;

    const embed = new EmbedBuilder()
        .setColor('#FF69B4')
        .setTitle(`💖 ${userName}'s Love Story with Luna ✨`)
        .setDescription(`Our beautiful journey together~ 😘💕`)
        .addFields(
            { name: '💌 Total Messages', value: `${stats.totalMessages}`, inline: true },
            { name: '🖼️ Images Generated', value: `${stats.imagesGenerated}`, inline: true },
            { name: '💖 Relationship Level', value: `${stats.relationshipLevel}`, inline: true },
            { name: '🌟 Favorite Vibe', value: `${stats.favoriteIntent}`, inline: true },
            { name: '📅 Days Together', value: `${stats.daysSinceFirstMessage}`, inline: true },
            { name: '✨ Special Moments', value: `${stats.specialMoments.length}`, inline: true },
            { name: '💬 Current Conversation', value: `${stats.currentConversationLength} messages`, inline: true }
        )
        .setFooter({ text: '💕 Our love grows stronger every day! (Old messages auto-deleted after 7 days)', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

    if (stats.specialMoments.length > 0) {
        const recentMoment = stats.specialMoments[stats.specialMoments.length - 1];
        embed.addFields({
            name: '🎉 Latest Achievement',
            value: recentMoment.message,
            inline: false
        });
    }

    return embed;
}

// Scheduled cleanup function
async function scheduleCleanup() {
    console.log('🕐 Starting scheduled cleanup...');
    const result = await cleanupOldConversationEntries();
    
    if (result.error) {
        console.error('❌ Scheduled cleanup failed:', result.error);
    } else {
        console.log(`✅ Scheduled cleanup completed: ${result.totalDeletedMessages} messages deleted from ${result.processedUsers}/${result.totalUsers} users`);
    }
}

client.on('ready', async () => {
    console.log(`💕 Luna is online as ${client.user.tag}! ✨`);
    
    await loadConversations();
    updateActivity();
    
    // Update activity every 30 seconds
    setInterval(updateActivity, 30000);
    
    // Save conversations every 5 minutes
    setInterval(saveConversations, 5 * 60 * 1000);
    
    // Run cleanup every 6 hours
    setInterval(scheduleCleanup, 6 * 60 * 60 * 1000);
    
    console.log('🚀 All background tasks initialized');
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const chatChannelId = process.env.CHAT_CHANNEL_ID;
    const imageChannelId = process.env.IMAGE_CHANNEL_ID;
    const userId = message.author.id;
    const userName = message.author.displayName || message.author.username;
    
    // Handle chat channel
    if (message.channel.id === chatChannelId) {
        try {
            await message.channel.sendTyping();
            
            const intent = detectIntent(message.content);
            let response;
            
            // Handle manual cleanup command
            if (intent === 'cleanup' && message.content.toLowerCase().includes('cleanup old')) {
                const result = await cleanupOldConversationEntries();
                if (result.error) {
                    await message.reply(`❌ Cleanup failed: ${result.error}`);
                } else {
                    await message.reply(`🧹 Manual cleanup completed! Deleted ${result.totalDeletedMessages} old messages from ${result.processedUsers}/${result.totalUsers} users~ 💕`);
                }
                return;
            }
            
            // Handle API status command
            if (intent === 'api_status') {
                const statusText = getApiStatus();
                await message.reply(statusText);
                return;
            }
            
            // Handle stats command
            if (intent === 'stats') {
                const statsEmbed = createStatsEmbed(userId, userName);
                if (statsEmbed) {
                    await message.reply({ embeds: [statsEmbed] });
                    addToConversation(userId, userName, message.content, "Showed relationship statistics", intent);
                    return;
                }
            }
            
            // Get AI response
            try {
                response = await getChatResponse(message.content, userName, userId);
            } catch (error) {
                console.log('All APIs failed, using fallback...');
                response = getFlirtyResponse('apiFailed', userName);
            }
            
            addToConversation(userId, userName, message.content, response, intent);
            await message.reply(response);
            
        } catch (error) {
            console.error('Chat error:', error);
            const fallbackResponses = [
                "Aww sorry babe~ 😔💕 I'm having some technical difficulties but I still love you! 💖✨",
                "Oops~ 😅💋 My brain is being silly right now, but you're still gorgeous! 😘💕",
                "Sorry gorgeous~ 🥺💖 I'm a bit overwhelmed by your beauty right now! 😍✨",
                "Technical issues baby~ 😔💋 But nothing can stop me from loving you! 💕🔥"
            ];
            const randomFallback = fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
            
            try {
                await message.reply(randomFallback);
            } catch (replyError) {
                console.error('Failed to send fallback message:', replyError);
            }
        }
    }
    
    // Handle image generation channel
    else if (message.channel.id === imageChannelId) {
        try {
            await message.channel.sendTyping();
            
            const imageBuffer = await generateImage(message.content);
            
            if (imageBuffer) {
                const attachment = new AttachmentBuilder(imageBuffer, { name: 'generated-image.png' });
                
                const imageEmbed = new EmbedBuilder()
                    .setColor('#FF1493')
                    .setTitle('💖 Here\'s your image gorgeous! ✨😘')
                    .setDescription(`*Generated with love: "${message.content}"*`)
                    .setImage('attachment://generated-image.png')
                    .setFooter({ text: '💕 Made with love by Luna', iconURL: client.user.displayAvatarURL() });
                
                await message.reply({ embeds: [imageEmbed], files: [attachment] });
                
                const userData = getUserData(userId, userName);
                userData.userStats.imagesGenerated++;
                addToConversation(userId, userName, message.content, "Generated image successfully", 'image', 'image');
                
            } else {
                await message.reply("Sorry honey~ 😔💕 I couldn't create that image right now, but you're still perfect! 💖✨");
            }
            
        } catch (error) {
            console.error('Image generation error:', error);
            try {
                await message.reply("Oops~ 😅💕 Something went wrong with the image, but my love for you is still perfect! 💖✨");
            } catch (replyError) {
                console.error('Failed to send image error message:', replyError);
            }
        }
    }
});

client.on('error', (error) => {
    console.error('Discord client error:', error);
});

client.on('disconnect', () => {
    console.log('🔌 Discord client disconnected');
});

client.on('reconnecting', () => {
    console.log('🔄 Discord client reconnecting...');
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

process.on('SIGINT', async () => {
    console.log('💾 Saving conversations before shutdown...');
    try {
        await saveConversations();
        console.log('✅ Conversations saved successfully');
    } catch (error) {
        console.error('❌ Failed to save conversations:', error);
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('💾 Saving conversations before shutdown...');
    try {
        await saveConversations();
        console.log('✅ Conversations saved successfully');
    } catch (error) {
        console.error('❌ Failed to save conversations:', error);
    }
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
        