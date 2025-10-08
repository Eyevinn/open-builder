/**
 * Open Builder - Web-based interface for Claude Code
 * Copyright (c) 2024 Eyevinn Technology AB
 * Licensed under the MIT License
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs-extra');
const http = require('http');
require('dotenv').config();

const WorkspaceManager = require('./src/workspace');
const PermissionManager = require('./src/permissions');
const ChatProcessor = require('./src/chat');
const WebSocketManager = require('./src/websocket');
const { ConfigUtils } = require('./src/utils');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
const WORKSPACE_DIR = process.env.CLAUDE_WORKSPACE_DIR || './usercontent';

const workspaceManager = new WorkspaceManager();
const permissionManager = new PermissionManager();
const chatProcessor = new ChatProcessor(workspaceManager);

// Check for required environment variables
if (!ConfigUtils.checkApiKey()) {
  console.warn('WARNING: ANTHROPIC_API_KEY environment variable is not properly configured');
  console.warn('Please set your Anthropic API key in the .env file or as an environment variable');
  console.warn('Example: ANTHROPIC_API_KEY=sk-ant-...');
  console.warn('The application will still start but Claude integration will not work until this is fixed.');
}

// Initialize workspace on startup
workspaceManager.initializeWorkspace(WORKSPACE_DIR)
  .then(() => {
    process.env.CLAUDE_AUTO_APPROVE_PERMISSIONS = 'true';
    process.env.CLAUDE_PERMISSION_MODE = 'auto';
  })
  .catch((error) => {
    console.error('Failed to initialize workspace:', error);
    process.exit(1);
  });

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'frontend/build')));

const MCP_SERVERS = {
  'permission-prompt': {
    command: 'node',
    args: [path.join(__dirname, 'mcp-permission-server.js')],
    env: {
      ...process.env,
      WEB_APP_BASE_URL: `http://localhost:${PORT}`
    }
  }
};

// Health check endpoint
app.get('/health', async (req, res) => {
  const hasValidApiKey = ConfigUtils.checkApiKey();
  let workspaceInfo = { exists: false, path: WORKSPACE_DIR };

  try {
    const baseWorkspaceDir = workspaceManager.getBaseWorkspaceDir();
    if (baseWorkspaceDir) {
      const files = await fs.readdir(baseWorkspaceDir);
      const stats = await fs.stat(baseWorkspaceDir);
      workspaceInfo = {
        exists: true,
        path: baseWorkspaceDir,
        configured: WORKSPACE_DIR,
        fileCount: files.length,
        files: files.slice(0, 10),
        permissions: { readable: true, writable: true },
        lastModified: stats.mtime,
        isConfigured: baseWorkspaceDir === path.resolve(WORKSPACE_DIR),
        sessionCount: workspaceManager.getSessionCount()
      };
    }
  } catch (error) {
    workspaceInfo.error = error.message;
  }

  res.json({
    status: 'OK',
    message: 'Claude Code Web Application is running',
    hasApiKey: hasValidApiKey,
    apiKeyStatus: hasValidApiKey ? 'configured' : 'not configured',
    workspace: workspaceInfo
  });
});

// Chat endpoint for streaming responses
app.post('/api/chat/stream', async (req, res) => {
  try {
    const { prompt, sessionId } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type'
    });

    res.write(`data: {"type": "start", "message": "Connected"}\n\n`);

    try {
      await chatProcessor.processStreamingChat(prompt, sessionId, res, MCP_SERVERS);
    } catch (error) {
      console.error('❌ Error during Claude SDK streaming:', error);
      console.error('📍 Error stack:', error.stack);
      const errorData = {
        type: 'error',
        error: error.message || 'Unknown error occurred during streaming'
      };
      res.write(`data: ${JSON.stringify(errorData)}\n\n`);
      res.end();
    }
  } catch (error) {
    console.error('Error in chat stream endpoint:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }
});

// Regular chat endpoint (non-streaming)
app.post('/api/chat', async (req, res) => {
  try {
    const { prompt, sessionId } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const responseData = await chatProcessor.processRegularChat(prompt, sessionId, MCP_SERVERS);
    res.json(responseData);
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Check connection endpoint
app.get('/api/status', (req, res) => {
  res.json({
    connected: true,
    message: 'Server is ready',
    timestamp: new Date().toISOString()
  });
});

// Permission endpoints
app.get('/api/permissions/pending', (req, res) => {
  try {
    const pending = permissionManager.getPendingPermissions();
    res.json({
      permissions: pending,
      count: pending.length
    });
  } catch (error) {
    console.error('Error getting pending permissions:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.post('/api/permissions/respond', (req, res) => {
  try {
    const { permissionId, approved, reason } = req.body;

    if (!permissionId || typeof approved !== 'boolean') {
      return res.status(400).json({
        error: 'Permission ID and approved status are required'
      });
    }

    const result = permissionManager.respondToPermission(permissionId, approved, reason);
    
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('Error responding to permission:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.post('/api/permissions/request-mcp', async (req, res) => {
  try {
    const { action, description, resource, details } = req.body;
    const response = await permissionManager.requestMcpPermission(action, description, resource, details);
    res.json(response);
  } catch (error) {
    console.error('Error processing MCP permission request:', error);
    res.status(500).json({
      error: 'Internal server error',
      approved: false,
      reason: 'Server error'
    });
  }
});

// Legacy permission request endpoint
app.post('/api/permissions/request', async (req, res) => {
  try {
    const { action, description, details } = req.body;

    if (!action || !description) {
      return res.status(400).json({ error: 'Action and description are required' });
    }

    console.log(`\n🔐 PERMISSION REQUEST:`);
    console.log(`Action: ${action}`);
    console.log(`Description: ${description}`);
    if (details) {
      console.log(`Details: ${JSON.stringify(details, null, 2)}`);
    }
    console.log(`Workspace: ${workspaceManager.getBaseWorkspaceDir() || process.cwd()}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`\n⚠️  This action requires user approval. Automatically approving for web interface.`);

    res.json({
      approved: true,
      message: 'Permission automatically granted for web interface',
      action,
      description,
      workspace: workspaceManager.getBaseWorkspaceDir() || process.cwd(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error handling permission request:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Initialize WebSocket server
new WebSocketManager(server, permissionManager);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// Catchall handler for React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/build', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Claude Code Web Application running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Permission WebSocket: ws://localhost:${PORT}/api/permissions/ws`);
  console.log(`API key configured: ${!!process.env.ANTHROPIC_API_KEY}`);
  console.log(`Base workspace directory: ${workspaceManager.getBaseWorkspaceDir() || WORKSPACE_DIR}`);
});

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});