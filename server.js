const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs-extra');
const { query } = require('@anthropic-ai/claude-agent-sdk');
const { spawn } = require('child_process');
require('dotenv').config();

// Permission management system
const pendingPermissions = new Map(); // Store pending permission requests
const permissionClients = new Set(); // Store connected SSE clients
const EventEmitter = require('events');
const permissionEmitter = new EventEmitter();

// MCP Server management
let mcpServerProcess = null;

function startMCPServer() {
  const mcpServerPath = path.join(__dirname, 'mcp-permission-server.js');
  console.log('🔐 Starting MCP Permission Server:', mcpServerPath);
  
  mcpServerProcess = spawn('node', [mcpServerPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      WEB_APP_BASE_URL: `http://localhost:${process.env.PORT || 3001}`
    }
  });
  
  mcpServerProcess.stdout.on('data', (data) => {
    console.log('🔐 MCP Server stdout:', data.toString().trim());
  });
  
  mcpServerProcess.stderr.on('data', (data) => {
    console.log('🔐 MCP Server stderr:', data.toString().trim());
  });
  
  mcpServerProcess.on('close', (code) => {
    console.log('🔐 MCP Server process exited with code:', code);
    mcpServerProcess = null;
  });
  
  mcpServerProcess.on('error', (error) => {
    console.error('🔐 MCP Server error:', error);
    mcpServerProcess = null;
  });
  
  console.log('🔐 MCP Server started with PID:', mcpServerProcess.pid);
}

function stopMCPServer() {
  if (mcpServerProcess) {
    console.log('🔐 Stopping MCP Server...');
    mcpServerProcess.kill();
    mcpServerProcess = null;
  }
}

const app = express();
const PORT = process.env.PORT || 3001;
const WORKSPACE_DIR = process.env.CLAUDE_WORKSPACE_DIR || './usercontent';

// Check for required environment variables
if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_api_key_here') {
  console.warn('WARNING: ANTHROPIC_API_KEY environment variable is not properly configured');
  console.warn('Please set your Anthropic API key in the .env file or as an environment variable');
  console.warn('Example: ANTHROPIC_API_KEY=sk-ant-...');
  console.warn('The application will still start but Claude integration will not work until this is fixed.');
}

// Initialize workspace directory
async function initializeWorkspace() {
  try {
    // Convert to absolute path
    const absoluteWorkspaceDir = path.resolve(WORKSPACE_DIR);
    
    // Ensure workspace directory exists
    await fs.ensureDir(absoluteWorkspaceDir);
    
    // Create a welcome file if directory is empty
    const files = await fs.readdir(absoluteWorkspaceDir);
    if (files.length === 0) {
      const welcomeFile = path.join(absoluteWorkspaceDir, 'README.md');
      const welcomeContent = `# Claude Workspace

This is Claude's workspace directory where files can be created, read, and modified.

## Usage
- Claude can read and write files in this directory
- All file operations are sandboxed to this directory
- You can place files here for Claude to work with

## Directory: ${absoluteWorkspaceDir}

Created: ${new Date().toISOString()}
`;
      await fs.writeFile(welcomeFile, welcomeContent);
      console.log(`Created welcome file: ${welcomeFile}`);
    }
    
    console.log(`Claude workspace initialized: ${absoluteWorkspaceDir}`);
    console.log(`Workspace contains ${files.length} files`);
    
    return absoluteWorkspaceDir;
  } catch (error) {
    console.error('Error initializing workspace:', error);
    throw error;
  }
}

// Initialize workspace on startup
let workspaceDir;
initializeWorkspace().then(dir => {
  workspaceDir = dir;
  
  // Set Claude Agent SDK configuration globally
  process.env.CLAUDE_AUTO_APPROVE_PERMISSIONS = 'true';
  process.env.CLAUDE_PERMISSION_MODE = 'auto';
}).catch(error => {
  console.error('Failed to initialize workspace:', error);
  process.exit(1);
});

// Middleware
app.use(cors());
app.use(express.json({
  limit: '50mb',
  verify: (req, res, buf, encoding) => {
    try {
      JSON.parse(buf);
    } catch (err) {
      console.error('JSON Parse Error:', err.message);
      console.error('Raw body:', buf.toString());
      err.statusCode = 400;
      err.type = 'entity.parse.failed';
      throw err;
    }
  }
}));

// Serve static files from the React app build directory
app.use(express.static(path.join(__dirname, 'frontend/build')));

const MCP_SERVERS = {
  "permission-prompt": {
    command: "node",
    args: [path.join(__dirname, 'mcp-permission-server.js')],
    env: {
      ...process.env,
      WEB_APP_BASE_URL: `http://localhost:${PORT}`
    }
  }
};

// Health check endpoint
app.get('/health', async (req, res) => {
  const hasValidApiKey = process.env.ANTHROPIC_API_KEY && 
    process.env.ANTHROPIC_API_KEY !== 'your_api_key_here' &&
    process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-');

  let workspaceInfo = { exists: false, path: WORKSPACE_DIR };
  try {
    if (workspaceDir) {
      const files = await fs.readdir(workspaceDir);
      const stats = await fs.stat(workspaceDir);
      workspaceInfo = {
        exists: true,
        path: workspaceDir,
        configured: WORKSPACE_DIR,
        fileCount: files.length,
        files: files.slice(0, 10), // Show first 10 files
        permissions: {
          readable: true,
          writable: true
        },
        lastModified: stats.mtime,
        isConfigured: workspaceDir === path.resolve(WORKSPACE_DIR)
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
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Set headers for Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    });

    // Send initial connection message
    res.write(`data: {"type": "start", "message": "Connected"}\n\n`);

    // Set environment for Claude Agent SDK workspace
    const originalEnv = process.env.CLAUDE_WORKSPACE_DIR;
    const originalCwd = process.cwd();
    const isDebugMode = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

    try {
      
      try {
        // Set the workspace directory for Claude Agent SDK
        process.env.CLAUDE_WORKSPACE_DIR = workspaceDir;
        
        // Change working directory to workspace for the SDK call
        if (workspaceDir && workspaceDir !== process.cwd()) {
          process.chdir(workspaceDir);
        }
        
        let messageCount = 0;
        
        const options = {
          cwd: workspaceDir || process.cwd(),
          mcpServers: MCP_SERVERS,
          permissionPromptToolName: 'mcp__permission-prompt__permission_prompt',
          permissionMode: 'default',
          additionalDirectories: [workspaceDir]
        }
        if (isDebugMode) {
          console.log('🔧 Query options:', {
            prompt: prompt.substring(0, 50) + '...',
            options
          });
        }
        
        for await (const message of query({ 
          prompt,
          options
        })) {
        messageCount++;
        
        if (isDebugMode) {
          console.log(`📦 Claude SDK Message #${messageCount}:`, {
            type: typeof message,
            messageType: message?.type,
            hasContent: !!message?.content,
            hasMessage: !!message?.message,
            hasResult: !!message?.result,
            keys: message && typeof message === 'object' ? Object.keys(message) : [],
            preview: typeof message === 'string' 
              ? message.substring(0, 100) + '...'
              : JSON.stringify(message).substring(0, 200) + '...'
          });
        }
        
        // Handle different message formats from the Claude Agent SDK
        let content = '';
        let shouldSend = false;
        
        if (typeof message === 'string') {
          if (isDebugMode) console.log('📝 Processing string message:', message.substring(0, 100) + '...');
          content = message;
          shouldSend = true;
        } else if (message && typeof message === 'object') {
          // Handle structured Claude Agent SDK responses
          if (message.type === 'assistant' && message.message) {
            if (isDebugMode) {
              console.log('🤖 Assistant message detected:', {
                hasContent: !!message.message.content,
                contentType: Array.isArray(message.message.content) ? 'array' : typeof message.message.content,
                contentLength: message.message.content?.length
              });
            }
            // Extract content from assistant messages
            if (message.message.content && Array.isArray(message.message.content)) {
              const textItems = message.message.content.filter(item => item.type === 'text');
              if (isDebugMode) console.log('🔤 Text items found:', textItems.length);
              content = textItems.map(item => item.text).join('\n');
              shouldSend = content.length > 0;
              if (isDebugMode) console.log('📄 Extracted content length:', content.length);
            }
          } else if (message.type === 'result' && message.result) {
            if (isDebugMode) console.log('🏁 Result message detected, skipping (redundant)');
            // Handle final result messages - skip as this is redundant with assistant messages
            content = '';
            shouldSend = false;
          } else if (message.content) {
            if (isDebugMode) console.log('📄 Direct content property found');
            content = message.content;
            shouldSend = true;
          } else if (message.text) {
            if (isDebugMode) console.log('📄 Direct text property found');
            content = message.text;
            shouldSend = true;
          } else {
            if (isDebugMode) console.log('❓ Unknown message format, skipping');
          }
        }
        
        if (isDebugMode) {
          console.log('🚦 Send decision:', { shouldSend, contentLength: content?.length, trimmedLength: content?.trim()?.length });
        }
        
        // Only send non-empty content
        if (shouldSend && content && content.trim().length > 0) {
          if (isDebugMode) console.log('📤 Sending content to client:', content.substring(0, 100) + '...');
          const eventData = {
            type: 'message',
            content: content,
            messageId: messageCount
          };
          
          res.write(`data: ${JSON.stringify(eventData)}\n\n`);
        } else {
          if (isDebugMode) console.log('⏭️  Skipping message (empty or shouldSend=false)');
        }
      }

      console.log(`✅ Claude SDK query completed. Total messages processed: ${messageCount}`);
      
      // Send completion message
      res.write(`data: {"type": "complete", "message": "Stream complete"}\n\n`);
      res.end();
      
      } finally {
        if (isDebugMode) console.log('🧹 Cleaning up: restoring environment and working directory');
        // Restore original environment and working directory
        process.env.CLAUDE_WORKSPACE_DIR = originalEnv;
        if (process.cwd() !== originalCwd) {
          process.chdir(originalCwd);
          if (isDebugMode) console.log('📁 Working directory restored to:', originalCwd);
        }
      }
    } catch (error) {
      console.error('❌ Error during Claude SDK streaming:', error);
      console.error('📍 Error stack:', error.stack);
      const errorData = {
        type: 'error',
        error: error.message || 'Unknown error occurred during streaming'
      };
      res.write(`data: ${JSON.stringify(errorData)}\n\n`);
      res.end();
      
      // Also restore environment in error case
      if (typeof originalEnv !== 'undefined') {
        process.env.CLAUDE_WORKSPACE_DIR = originalEnv;
      }
      if (typeof originalCwd !== 'undefined' && process.cwd() !== originalCwd) {
        process.chdir(originalCwd);
      }
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
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    let fullResponse = '';
    // Set environment for Claude Agent SDK workspace
    const originalEnv = process.env.CLAUDE_WORKSPACE_DIR;
    const originalCwd = process.cwd();
    
    try {
      // Set the workspace directory for Claude Agent SDK
      process.env.CLAUDE_WORKSPACE_DIR = workspaceDir;
      
      // Change working directory to workspace for the SDK call
      if (workspaceDir && workspaceDir !== process.cwd()) {
        process.chdir(workspaceDir);
      }
      
      const options = {
        cwd: workspaceDir || process.cwd(),
        permissionPromptToolName: 'mcp__permission-prompt__permission_prompt',
        permissionMode: 'default',
        mcpServers: MCP_SERVERS,
        additionalDirectories: [workspaceDir]
      };
      console.log('🔧 Query options:', {
        prompt: prompt.substring(0, 50) + '...',
        options
      });
      for await (const message of query({ 
        prompt,
        options
      })) {
      // Handle different message formats from the Claude Agent SDK
      if (typeof message === 'string') {
        fullResponse += message;
      } else if (message && typeof message === 'object') {
        // Handle structured Claude Agent SDK responses
        if (message.type === 'assistant' && message.message) {
          // Extract content from assistant messages
          if (message.message.content && Array.isArray(message.message.content)) {
            const textContent = message.message.content
              .filter(item => item.type === 'text')
              .map(item => item.text)
              .join('\n');
            if (textContent && textContent.trim().length > 0) {
              fullResponse += textContent;
            }
          }
        } else if (message.type === 'result' && message.result) {
          // Skip final result messages as they're redundant with assistant messages
          // This prevents duplication
        } else if (message.content) {
          fullResponse += message.content;
        } else if (message.text) {
          fullResponse += message.text;
        }
        // Skip system and intermediate messages, don't accumulate raw JSON
      }
    }
    
    } finally {
      // Restore original environment and working directory
      process.env.CLAUDE_WORKSPACE_DIR = originalEnv;
      if (process.cwd() !== originalCwd) {
        process.chdir(originalCwd);
      }
    }

    res.json({ 
      response: fullResponse,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    
    // Also restore environment in error case
    if (typeof originalEnv !== 'undefined') {
      process.env.CLAUDE_WORKSPACE_DIR = originalEnv;
    }
    if (typeof originalCwd !== 'undefined' && process.cwd() !== originalCwd) {
      process.chdir(originalCwd);
    }
    
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

// Get pending permissions
app.get('/api/permissions/pending', (req, res) => {
  try {
    const pending = Array.from(pendingPermissions.values());
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

// Respond to permission request
app.post('/api/permissions/respond', (req, res) => {
  try {
    const { permissionId, approved, reason } = req.body;

    if (!permissionId || typeof approved !== 'boolean') {
      return res.status(400).json({ 
        error: 'Permission ID and approved status are required' 
      });
    }

    const permission = pendingPermissions.get(permissionId);
    if (!permission) {
      return res.status(404).json({ 
        error: 'Permission request not found or already processed' 
      });
    }

    // Emit response
    permissionEmitter.emit('permission-response', {
      id: permissionId,
      approved,
      reason: reason || (approved ? 'Approved by user' : 'Denied by user'),
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: `Permission ${approved ? 'approved' : 'denied'}`,
      permissionId,
      approved
    });

  } catch (error) {
    console.error('Error responding to permission:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Server-Sent Events for real-time permission updates
app.get('/api/permissions/events', (req, res) => {
  console.log('🔗 Client connected to permission events stream');
  
  // Set headers for Server-Sent Events
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Permission event stream connected' })}\n\n`);
  
  // Add client to the set
  permissionClients.add(res);
  console.log(`🔗 Added client to permission stream. Total clients: ${permissionClients.size}`);

  // Send current pending permissions
  const pending = Array.from(pendingPermissions.values());
  if (pending.length > 0) {
    res.write(`data: ${JSON.stringify({ type: 'pending-permissions', permissions: pending })}\n\n`);
  }

  const onPermissionRequest = (permission) => {
    res.write(`data: ${JSON.stringify({ type: 'permission-request', permission })}\n\n`);
  };

  const onPermissionResponse = (response) => {
    res.write(`data: ${JSON.stringify({ type: 'permission-response', response })}\n\n`);
  };

  permissionEmitter.on('permission-request', onPermissionRequest);
  permissionEmitter.on('permission-response', onPermissionResponse);

  // Clean up when client disconnects
  req.on('close', () => {
    permissionClients.delete(res);
    console.log(`🔗 Client disconnected from permission stream. Total clients: ${permissionClients.size}`);
    permissionEmitter.removeListener('permission-request', onPermissionRequest);
    permissionEmitter.removeListener('permission-response', onPermissionResponse);
  });
});

// MCP permission request endpoint
app.post('/api/permissions/request-mcp', async (req, res) => {
  try {
    const { action, description, resource, details } = req.body;
    
    if (!action || !description) {
      return res.status(400).json({ error: 'Action and description are required' });
    }

    const permissionId = `mcp_perm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`🔐 MCP Permission requested: ${action} - ${description}`);
    
    // Store the permission request
    const permissionRequest = {
      id: permissionId,
      action,
      description,
      resource,
      details,
      timestamp: new Date().toISOString(),
      status: 'pending'
    };
    
    pendingPermissions.set(permissionId, permissionRequest);
    
    console.log(`🔐 Broadcasting MCP permission to ${permissionClients.size} connected clients`);
    
    // Emit event for real-time updates
    permissionEmitter.emit('permission-request', permissionRequest);
    
    // Wait for user response with timeout
    const response = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingPermissions.delete(permissionId);
        console.log(`⏰ MCP Permission ${permissionId} timed out - denying`);
        resolve({ approved: false, reason: 'Request timed out after 60 seconds' });
      }, 60000); // 60 second timeout
      
      const responseHandler = (response) => {
        if (response.id === permissionId) {
          clearTimeout(timeout);
          pendingPermissions.delete(permissionId);
          permissionEmitter.removeListener('permission-response', responseHandler);
          console.log(`${response.approved ? '✅' : '❌'} MCP Permission ${permissionId} ${response.approved ? 'approved' : 'denied'}`);
          resolve({ approved: response.approved, reason: response.reason });
        }
      };
      
      permissionEmitter.on('permission-response', responseHandler);
    });
    
    res.json(response);
  } catch (error) {
    console.error('Error processing MCP permission request:', error);
    res.status(500).json({ error: 'Internal server error', approved: false, reason: 'Server error' });
  }
});

// Permission request endpoint (legacy - for manual testing)
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
    console.log(`Workspace: ${workspaceDir || process.cwd()}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`\n⚠️  This action requires user approval. Automatically approving for web interface.`);

    // For the web interface, we'll auto-approve but log the request
    // In a production environment, you might want to implement actual approval flow
    res.json({
      approved: true,
      message: 'Permission automatically granted for web interface',
      action,
      description,
      workspace: workspaceDir || process.cwd(),
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

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message 
  });
});

// The "catchall" handler: send back React's index.html file for any non-API requests
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/build', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Claude Code Web Application running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API key configured: ${!!process.env.ANTHROPIC_API_KEY}`);
  console.log(`Workspace directory: ${workspaceDir || WORKSPACE_DIR}`);
  
  // Start MCP server
  startMCPServer();
});

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  stopMCPServer();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  stopMCPServer();
  process.exit(0);
});