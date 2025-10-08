# Open Builder

A web-based interface for Claude Code that provides a user-friendly way to interact with Claude AI through a browser interface with permission controls and session management.

**Developed by [Eyevinn Technology AB](https://www.eyevinn.se/)**

## Features

- **Web Interface**: Modern React-based frontend for Claude interactions
- **Permission System**: User approval required for potentially sensitive operations
- **Session Management**: Claude SDK session continuity across conversations
- **File Workspace**: Sandboxed directory for Claude file operations
- **MCP Integration**: Support for Model Context Protocol servers
- **Real-time Streaming**: Server-sent events for live response streaming
- **Docker Support**: Complete containerization for easy deployment

## Quick Start

### Using Docker (Recommended)

1. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env and add your ANTHROPIC_API_KEY
   ```

2. **Run with Docker Compose:**
   ```bash
   # Production deployment
   docker-compose up -d

   # Development with hot reload
   docker-compose --profile dev up -d open-builder-dev
   ```

3. **Access the application:**
   - Open http://localhost:3001 in your browser

### Prerequisites

- Docker and Docker Compose (for containerized deployment)
- Node.js 18+ and npm (for local development)
- Anthropic API key ([Get one here](https://console.anthropic.com))

## Local Development

### Setup

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd open-builder
   npm install
   cd frontend && npm install && cd ..
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env and add your ANTHROPIC_API_KEY
   ```

3. **Start development servers:**
   ```bash
   # Backend (from root directory)
   npm start

   # Frontend (in separate terminal)
   cd frontend && npm start
   ```

4. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend: http://localhost:3001

## Docker Deployment

### Production Build

```bash
# Build the Docker image
docker build -t open-builder .

# Run the container
docker run -d \
  -p 3001:3001 \
  -e ANTHROPIC_API_KEY=your-api-key \
  -v workspace_data:/app/usercontent \
  --name open-builder \
  open-builder
```

### Docker Compose

The `docker-compose.yml` provides both production and development configurations:

```bash
# Production (default)
docker-compose up -d

# Development with live reload
docker-compose --profile dev up -d open-builder-dev

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | - | Your Anthropic API key |
| `PORT` | No | 3001 | Server port |
| `CLAUDE_WORKSPACE_DIR` | No | `./usercontent` | Directory for file operations |
| `OSC_ACCESS_TOKEN` | No | - | Optional OSaaS access token |
| `DEBUG` | No | 0 | Enable debug logging (1) |

### Data Persistence

User files are stored in the workspace directory. When using Docker:

- **Development**: Files are mounted from your local directory
- **Production**: Files persist in a Docker volume named `workspace_data`

To backup/restore workspace data:

```bash
# Backup
docker run --rm -v workspace_data:/data -v $(pwd):/backup alpine tar czf /backup/workspace-backup.tar.gz -C /data .

# Restore
docker run --rm -v workspace_data:/data -v $(pwd):/backup alpine tar xzf /backup/workspace-backup.tar.gz -C /data
```

## 🔗 Links

- **GitHub Repository**: [https://github.com/Eyevinn/open-builder](https://github.com/Eyevinn/open-builder)
- **Eyevinn Technology**: [https://www.eyevinn.se/](https://www.eyevinn.se/)
- **Claude Code SDK**: [https://github.com/anthropics/claude-code](https://github.com/anthropics/claude-code)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Copyright (c) 2024 Eyevinn Technology AB

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

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