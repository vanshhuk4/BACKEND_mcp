const express = require('express');
const session = require('express-session');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const OpenAI = require('openai');

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Import models and services
const User = require('./models/User');
const Chat = require('./models/Chat');
const Message = require('./models/Message');
const Attachment = require('./models/Attachment');
const AuthToken = require('./models/AuthToken');
const FileUploadService = require('./services/fileUpload');
const FileParser = require('./services/fileParser');
const upload = require('./middleware/upload');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Google OAuth client
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost:5173',
      'http://localhost:3000',
      'https://ai-chatbot-frontend-9dq0.onrender.com'
    ].filter(Boolean);
    
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));

// MCP server management
let mcpProcess = null;
let mcpReady = false;

// Start MCP server
async function startMCPServer(userTokens = null) {
  try {
    console.log('🚀 Starting MCP server...');
    
    if (mcpProcess) {
      console.log('⚠️ Killing existing MCP process...');
      mcpProcess.kill();
      mcpProcess = null;
    }

    const pythonPath = process.env.PYTHON_PATH || 'python3';
    const scriptPath = path.join(__dirname, 'mcp_toolkit.py');
    
    console.log(`Using Python: ${pythonPath}`);
    console.log(`Script path: ${scriptPath}`);
    
    // Set up environment variables for the MCP server
    const env = { ...process.env };
    
    if (userTokens) {
      env.GOOGLE_ACCESS_TOKEN = userTokens.access_token;
      env.GOOGLE_REFRESH_TOKEN = userTokens.refresh_token;
      env.GOOGLE_ID_TOKEN = userTokens.id_token;
      env.GOOGLE_TOKEN_EXPIRES_AT = userTokens.expires_at;
      console.log('✅ User tokens provided to MCP server');
    }

    mcpProcess = spawn(pythonPath, [scriptPath], {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    mcpProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('MCP stdout:', output);
      
      if (output.includes('MCP server ready')) {
        mcpReady = true;
        console.log('✅ MCP server is ready!');
      }
    });

    mcpProcess.stderr.on('data', (data) => {
      console.error('MCP stderr:', data.toString());
    });

    mcpProcess.on('close', (code) => {
      console.log(`MCP process exited with code ${code}`);
      mcpReady = false;
      mcpProcess = null;
    });

    mcpProcess.on('error', (error) => {
      console.error('MCP process error:', error);
      mcpReady = false;
      mcpProcess = null;
    });

    // Wait a bit for the server to start
    await new Promise(resolve => setTimeout(resolve, 3000));
    
  } catch (error) {
    console.error('❌ Failed to start MCP server:', error);
    mcpReady = false;
  }
}

// Initialize MCP server on startup
startMCPServer();

// Google OAuth routes
app.get('/auth/google', (req, res) => {
  console.log('🔍 Initiating Google OAuth...');
  
  const scopes = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/calendar'
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  console.log('🔗 Redirecting to:', authUrl);
  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  console.log('📥 Google OAuth callback received');
  console.log('Query params:', req.query);
  
  try {
    const { code, error } = req.query;

    if (error) {
      console.error('❌ OAuth error:', error);
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=${encodeURIComponent(error)}`);
    }

    if (!code) {
      console.error('❌ No authorization code received');
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);
    }

    console.log('🔄 Exchanging code for tokens...');
    const { tokens } = await oauth2Client.getTokens(code);
    console.log('✅ Tokens received');

    // Set credentials for this request
    oauth2Client.setCredentials(tokens);

    // Get user info
    console.log('👤 Fetching user info...');
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    console.log('✅ User info received:', payload.email);

    // Find or create user
    let user = await User.findByGoogleId(payload.sub);
    
    if (!user) {
      console.log('👤 Creating new user...');
      user = await User.create({
        googleId: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture
      });
      console.log('✅ User created:', user.id);
    } else {
      console.log('✅ Existing user found:', user.id);
      // Update user info
      user = await User.update(user.id, {
        name: payload.name,
        picture: payload.picture
      });
    }

    // Store or update tokens
    const expiresAt = new Date(Date.now() + (tokens.expiry_date || 3600000));
    
    try {
      const existingToken = await AuthToken.findByUserId(user.id);
      if (existingToken) {
        await AuthToken.update(user.id, {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || existingToken.refresh_token,
          idToken: tokens.id_token,
          expiresAt: expiresAt.toISOString()
        });
      } else {
        await AuthToken.create({
          userId: user.id,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token,
          expiresAt: expiresAt.toISOString()
        });
      }
      console.log('✅ Tokens stored in database');
    } catch (tokenError) {
      console.error('❌ Failed to store tokens:', tokenError);
    }

    // Set session
    req.session.userId = user.id;
    req.session.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture
    };

    console.log('✅ Session created for user:', user.email);

    // Restart MCP server with new tokens
    console.log('🔄 Restarting MCP server with user tokens...');
    await startMCPServer({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      id_token: tokens.id_token,
      expires_at: expiresAt.toISOString()
    });

    // Redirect to frontend
    console.log('🔄 Redirecting to frontend...');
    res.redirect(`${process.env.FRONTEND_URL}/chat`);

  } catch (error) {
    console.error('❌ OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=${encodeURIComponent(error.message)}`);
  }
});

// Auth check endpoint
app.get('/auth/user', (req, res) => {
  console.log('🔍 Auth check - Session:', req.session.userId ? 'exists' : 'none');
  
  if (req.session.userId && req.session.user) {
    res.json({
      authenticated: true,
      user: req.session.user
    });
  } else {
    res.json({
      authenticated: false,
      user: null
    });
  }
});

// Logout endpoint
app.post('/auth/logout', async (req, res) => {
  try {
    console.log('👋 User logging out:', req.session.user?.email);
    
    if (req.session.userId) {
      // Clean up tokens
      try {
        await AuthToken.delete(req.session.userId);
      } catch (error) {
        console.error('Error cleaning up tokens:', error);
      }
    }
    
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destruction error:', err);
        return res.status(500).json({ error: 'Failed to logout' });
      }
      
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

// Chat endpoints
app.post('/api/chat', requireAuth, upload.array('attachments', 5), async (req, res) => {
  try {
    console.log('💬 Chat request received from user:', req.session.user.email);
    
    const { message, chatId, model = 'gpt-4', enabledTools = [] } = req.body;
    const files = req.files || [];
    
    console.log('Message:', message);
    console.log('Files:', files.length);
    console.log('Model:', model);
    console.log('Enabled tools:', enabledTools);

    if (!message && files.length === 0) {
      return res.status(400).json({ error: 'Message or files required' });
    }

    let currentChat;
    
    // Get or create chat
    if (chatId && chatId !== 'new') {
      currentChat = await Chat.findById(chatId);
      if (!currentChat || currentChat.user_id !== req.session.userId) {
        return res.status(404).json({ error: 'Chat not found' });
      }
    } else {
      // Create new chat
      const title = message ? message.substring(0, 50) + (message.length > 50 ? '...' : '') : 'File Upload';
      currentChat = await Chat.create(req.session.userId, title);
      console.log('✅ New chat created:', currentChat.id);
    }

    // Handle file uploads
    let attachmentData = [];
    let fileContents = [];
    
    if (files.length > 0) {
      console.log(`📎 Processing ${files.length} file(s)...`);
      
      for (const file of files) {
        try {
          // Upload file to Supabase Storage
          const uploadResult = await FileUploadService.uploadFile(file, req.session.userId);
          
          // Create attachment record
          const attachment = await Attachment.create({
            messageId: null, // Will be set after message is created
            userId: req.session.userId,
            filename: uploadResult.filename,
            originalName: uploadResult.originalName,
            mimeType: uploadResult.mimeType,
            fileSize: uploadResult.fileSize,
            storagePath: uploadResult.storagePath
          });
          
          attachmentData.push(attachment);
          
          // Parse file content
          const content = await FileParser.parseFile(
            uploadResult.storagePath,
            uploadResult.mimeType,
            uploadResult.originalName
          );
          
          fileContents.push({
            filename: uploadResult.originalName,
            content: content
          });
          
          console.log(`✅ File processed: ${uploadResult.originalName}`);
        } catch (fileError) {
          console.error(`❌ Error processing file ${file.originalname}:`, fileError);
          fileContents.push({
            filename: file.originalname,
            content: `Error processing file: ${fileError.message}`
          });
        }
      }
    }

    // Create user message
    const userMessage = await Message.create({
      chatId: currentChat.id,
      userId: req.session.userId,
      role: 'user',
      content: message || 'File upload',
      attachments: attachmentData.map(att => ({
        id: att.id,
        filename: att.filename,
        original_name: att.original_name,
        mime_type: att.mime_type,
        file_size: att.file_size,
        storage_path: att.storage_path
      }))
    });

    // Update attachment records with message ID
    for (const attachment of attachmentData) {
      await Attachment.update(attachment.id, { messageId: userMessage.id });
    }

    // Prepare message for OpenAI
    let fullMessage = message || '';
    
    if (fileContents.length > 0) {
      fullMessage += '\n\nAttached files:\n';
      fileContents.forEach(file => {
        fullMessage += `\n--- ${file.filename} ---\n${file.content}\n`;
      });
    }

    // Get available tools (fallback list)
    const availableTools = [
      {
        type: "function",
        function: {
          name: "drive_search_files",
          description: "Search for files in Google Drive by name or content",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              file_type: { type: "string", description: "File type filter (optional)" }
            },
            required: ["query"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "gmail_send_email",
          description: "Send an email via Gmail",
          parameters: {
            type: "object",
            properties: {
              to: { type: "string", description: "Recipient email address" },
              subject: { type: "string", description: "Email subject" },
              body: { type: "string", description: "Email body" }
            },
            required: ["to", "subject", "body"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "calendar_create_event",
          description: "Create a calendar event",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Event title" },
              start_time: { type: "string", description: "Start time (ISO format)" },
              end_time: { type: "string", description: "End time (ISO format)" },
              description: { type: "string", description: "Event description" }
            },
            required: ["title", "start_time", "end_time"]
          }
        }
      }
    ];

    // Filter tools based on enabled tools
    const tools = enabledTools.length > 0 
      ? availableTools.filter(tool => enabledTools.includes(tool.function.name))
      : availableTools;

    console.log(`🤖 Calling OpenAI with ${tools.length} tools...`);

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: `You are a helpful AI assistant with access to Google Workspace tools. You can help users with:
          - Google Drive: Search, read, create, and manage files
          - Gmail: Send emails, read messages, manage inbox
          - Google Calendar: Create events, check availability, manage schedule
          
          When users upload files, analyze their content and provide helpful insights.
          Always be helpful, accurate, and professional.`
        },
        {
          role: "user",
          content: fullMessage
        }
      ],
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined,
      temperature: 0.7,
      max_tokens: 2000
    });

    const assistantMessage = completion.choices[0].message;
    let responseContent = assistantMessage.content || '';
    let toolsUsed = [];

    // Handle tool calls (if any)
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      console.log(`🔧 Processing ${assistantMessage.tool_calls.length} tool call(s)...`);
      
      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        toolsUsed.push(toolName);
        
        console.log(`🔧 Tool call: ${toolName}`);
        
        // For now, return a placeholder response
        // In production, this would call the actual MCP server
        responseContent += `\n\n[Tool: ${toolName}] This tool would be executed with the MCP server. Currently showing placeholder response.`;
      }
    }

    // Create assistant message
    await Message.create({
      chatId: currentChat.id,
      userId: req.session.userId,
      role: 'assistant',
      content: responseContent,
      model: model,
      toolsUsed: toolsUsed
    });

    // Update chat timestamp
    await Chat.update(currentChat.id, { updated_at: new Date().toISOString() });

    console.log('✅ Chat response generated successfully');

    res.json({
      response: responseContent,
      chatId: currentChat.id,
      model: model,
      toolsUsed: toolsUsed
    });

  } catch (error) {
    console.error('❌ Chat error:', error);
    res.status(500).json({ 
      error: 'Failed to process chat message',
      details: error.message 
    });
  }
});

// Get chat by ID
app.get('/api/chat/:chatId', requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const chat = await Chat.getWithMessages(chatId, req.session.userId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    res.json(chat);
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({ error: 'Failed to get chat' });
  }
});

// Get user chats
app.get('/api/chats/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Ensure user can only access their own chats
    if (userId !== req.session.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const chats = await Chat.findByUserId(userId);
    res.json({ chats });
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Failed to get chats' });
  }
});

// Delete chat
app.delete('/api/chat/:chatId', requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    
    // Verify ownership
    const chat = await Chat.findById(chatId);
    if (!chat || chat.user_id !== req.session.userId) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    await Chat.delete(chatId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete chat error:', error);
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

// Get available tools
app.get('/api/tools', requireAuth, (req, res) => {
  const tools = [
    {
      function: {
        name: "drive_search_files",
        description: "Search for files in Google Drive by name or content"
      }
    },
    {
      function: {
        name: "drive_read_file",
        description: "Read the content of a file from Google Drive"
      }
    },
    {
      function: {
        name: "drive_create_file",
        description: "Create a new file in Google Drive"
      }
    },
    {
      function: {
        name: "gmail_send_email",
        description: "Send an email via Gmail"
      }
    },
    {
      function: {
        name: "gmail_list_emails",
        description: "List emails from Gmail inbox"
      }
    },
    {
      function: {
        name: "calendar_create_event",
        description: "Create a new calendar event"
      }
    },
    {
      function: {
        name: "calendar_list_events",
        description: "List upcoming calendar events"
      }
    }
  ];
  
  res.json({ tools });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    mcp_ready: mcpReady,
    environment: process.env.NODE_ENV || 'development'
  });
});

// MCP status endpoint
app.get('/api/mcp/status', (req, res) => {
  res.json({
    ready: mcpReady,
    process_running: mcpProcess !== null,
    process_pid: mcpProcess ? mcpProcess.pid : null
  });
});

// Restart MCP server endpoint
app.post('/api/mcp/restart', requireAuth, async (req, res) => {
  try {
    console.log('🔄 Manual MCP restart requested by:', req.session.user.email);
    
    // Get user tokens
    let userTokens = null;
    try {
      userTokens = await AuthToken.createTemporaryTokenFile(req.session.userId);
    } catch (error) {
      console.error('Failed to get user tokens:', error);
    }
    
    await startMCPServer(userTokens);
    
    res.json({ 
      success: true, 
      ready: mcpReady,
      message: 'MCP server restart initiated'
    });
  } catch (error) {
    console.error('MCP restart error:', error);
    res.status(500).json({ error: 'Failed to restart MCP server' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  console.log('404 - Route not found:', req.method, req.path);
  res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  
  if (mcpProcess) {
    mcpProcess.kill();
  }
  
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  
  if (mcpProcess) {
    mcpProcess.kill();
  }
  
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`🔐 Google OAuth configured: ${!!process.env.GOOGLE_CLIENT_ID}`);
  console.log(`🤖 OpenAI configured: ${!!process.env.OPENAI_API_KEY}`);
  console.log(`💾 Supabase configured: ${!!process.env.SUPABASE_URL}`);
});