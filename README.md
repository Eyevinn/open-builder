# Claude Code Web Application

A unified web application that provides a modern frontend interface to the Claude Code SDK. The application features server-side Claude integration with environment-based API key management for enhanced security.

## 🚀 Features

- **Unified Application**: Single server serving both backend API and frontend static files
- **Server-Side Integration**: All Claude API interactions happen on the server for security
- **Environment-Based Configuration**: API key managed through environment variables
- **Configurable Workspace**: Sandboxed directory for Claude file operations
- **Real-time Chat Interface**: Stream responses from Claude in real-time
- **Responsive Design**: Works seamlessly on desktop and mobile devices
- **Auto-Connection**: Frontend automatically connects to the backend on startup

## 🏗️ Architecture

This is a single Node.js application that:

1. **Serves Static Files**: Built React frontend served from `/frontend/build`
2. **Provides API Endpoints**: RESTful API for Claude integration
3. **Handles Authentication**: API key stored securely as environment variable
4. **Manages Workspace**: Creates and manages a sandboxed directory for file operations
5. **Streams Responses**: Server-Sent Events for real-time chat experience

## 📋 Prerequisites

- Node.js 16.0 or higher
- npm 7.0 or higher
- Anthropic API key ([Get one here](https://console.anthropic.com))

## 🛠️ Installation & Setup

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd open-builder
npm install
```

This will automatically install both backend and frontend dependencies.

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit the `.env` file and set your Anthropic API key:

```bash
# .env
PORT=3001
ANTHROPIC_API_KEY=sk-ant-your-actual-api-key-here
CLAUDE_WORKSPACE_DIR=./usercontent
```

**Important**: Replace `sk-ant-your-actual-api-key-here` with your actual Anthropic API key from [console.anthropic.com](https://console.anthropic.com).

### 3. Build the Frontend

```bash
npm run build
```

This builds the React frontend for production and places it in `frontend/build`.

### 4. Start the Application

```bash
npm start
```

The application will start on `http://localhost:3001` (or the port specified in your `.env` file).

## 🚀 Usage

1. **Start the Server**: Run `npm start`
2. **Open Browser**: Navigate to `http://localhost:3001`
3. **Auto-Connect**: The app automatically connects to the backend
4. **Workspace Ready**: Claude can read/write files in the configured workspace
5. **Start Chatting**: Begin interacting with Claude immediately

## 📁 Project Structure

```
open-builder/
├── frontend/                 # React frontend application
│   ├── src/
│   │   ├── components/      # React components
│   │   │   ├── ChatInterface.tsx
│   │   │   └── ConnectionSetup.tsx
│   │   ├── contexts/        # React contexts
│   │   │   └── ClaudeContext.tsx
│   │   ├── services/        # API services
│   │   │   └── claudeService.ts
│   │   └── ...
│   └── build/               # Production build (after npm run build)
├── server.js                # Main server file
├── package.json             # Dependencies and scripts
├── .env                     # Environment variables (create from .env.example)
├── .env.example             # Environment template
├── usercontent/             # Claude workspace directory (auto-created)
│   └── README.md           # Workspace welcome file
└── README.md
```

## 🔧 API Endpoints

The server provides the following endpoints:

- `GET /health` - Health check with API key status
- `GET /api/status` - Connection status check
- `POST /api/chat` - Single message chat endpoint
- `POST /api/chat/stream` - Streaming chat endpoint (Server-Sent Events)
- `GET *` - Serves React frontend for all other routes

## 🛡️ Security Features

- **Server-Side API Key**: API key never exposed to the browser
- **Environment Variables**: Secure configuration management
- **No Client-Side Secrets**: All authentication handled on the server
- **CORS Configuration**: Proper cross-origin resource sharing setup

## 📂 Workspace Directory

Claude operates within a configurable workspace directory for file operations:

### Default Configuration
- **Default Path**: `./usercontent` (relative to project root)
- **Auto-Creation**: Directory is created automatically on server startup
- **Welcome File**: A `README.md` is created if the directory is empty

### Customizing Workspace
Set the `CLAUDE_WORKSPACE_DIR` environment variable:

```bash
# Use absolute path
CLAUDE_WORKSPACE_DIR=/home/user/claude-workspace

# Use relative path
CLAUDE_WORKSPACE_DIR=./my-custom-workspace

# Use system temp directory
CLAUDE_WORKSPACE_DIR=/tmp/claude-work
```

### Workspace Features
- **Sandboxed Operations**: All Claude file operations are limited to this directory
- **Persistent Storage**: Files remain between sessions
- **Security**: Claude cannot access files outside this directory
- **Automatic Setup**: Directory structure is initialized automatically

### Use Cases
- **Project Development**: Place project files for Claude to analyze/modify
- **Data Analysis**: Store CSV, JSON files for Claude to process
- **Code Generation**: Let Claude create and modify code files
- **Documentation**: Generate and maintain project documentation

## 🎛️ Available Scripts

- `npm start` - Start the production server
- `npm run build` - Build the frontend for production
- `npm run build:frontend` - Install frontend deps and build
- `npm run dev` - Alias for `npm start`

## 🚨 Troubleshooting

### Server won't start
- **Check API Key**: Ensure `ANTHROPIC_API_KEY` is set in `.env`
- **Port in Use**: Make sure port 3001 (or your chosen port) isn't already in use
- **Node Version**: Verify Node.js version is 16.0 or higher

### Frontend shows connection error
- **Server Running**: Ensure the server started successfully
- **API Key**: Check server logs for API key configuration warnings
- **Network**: Verify no firewall blocking local connections

### Chat not working
- **API Key Valid**: Verify your Anthropic API key is correct and active
- **Credits**: Ensure you have sufficient credits in your Anthropic account
- **Server Logs**: Check the server console for detailed error messages

## 🔧 Development

### Frontend Development
```bash
cd frontend
npm start
```

This starts the frontend in development mode (separate from the main server).

### Server Development
```bash
npm run dev
```

The server will serve the built frontend and provide API endpoints.

## 🌐 Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Server port | No | 3001 |
| `ANTHROPIC_API_KEY` | Your Anthropic API key | Yes | - |
| `CLAUDE_WORKSPACE_DIR` | Directory for Claude file operations | No | `./usercontent` |

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

This project is licensed under the ISC License.

## 🔗 Related Links

- [Anthropic Claude API Documentation](https://docs.anthropic.com/)
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)
- [React Documentation](https://reactjs.org/)
- [Express.js Documentation](https://expressjs.com/)

## 📞 Support

If you encounter any issues:

1. Check the troubleshooting section above
2. Review the server console logs for error messages
3. Ensure your Anthropic API key is valid and has sufficient credits
4. Verify both the server started successfully and the build completed

## 🎯 Quick Start Summary

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your API key

# 3. Build and start
npm run build
npm start

# 4. Open browser
# http://localhost:3001
```

Your Claude Code web application is now running! 🎉