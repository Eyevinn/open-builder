/**
 * Open Builder - Web-based interface for Claude Code
 * Copyright (c) 2024 Eyevinn Technology AB
 * Licensed under the MIT License
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs-extra');
const { query } = require('@anthropic-ai/claude-agent-sdk');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const http = require('http');
require('dotenv').config();

// Permission management system
const pendingPermissions = new Map(); // Store pending permission requests
const permissionClients = new Map(); // Store connected WebSocket clients with unique IDs
const EventEmitter = require('events');
const permissionEmitter = new EventEmitter();

// Session-based workspace management
const sessionWorkspaces = new Map(); // Store session ID to workspace directory mapping

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
const WORKSPACE_DIR = process.env.CLAUDE_WORKSPACE_DIR || './usercontent';

// Check for required environment variables
if (
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY === 'your_api_key_here'
) {
  console.warn(
    'WARNING: ANTHROPIC_API_KEY environment variable is not properly configured'
  );
  console.warn(
    'Please set your Anthropic API key in the .env file or as an environment variable'
  );
  console.warn('Example: ANTHROPIC_API_KEY=sk-ant-...');
  console.warn(
    'The application will still start but Claude integration will not work until this is fixed.'
  );
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

// Create a unique workspace directory for a new session
async function createSessionWorkspace(baseWorkspaceDir) {
  try {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const sessionWorkspaceDir = path.join(baseWorkspaceDir, sessionId);
    
    // Ensure the session workspace directory exists
    await fs.ensureDir(sessionWorkspaceDir);
    
    // Create a session README file
    const readmeFile = path.join(sessionWorkspaceDir, 'README.md');
    const readmeContent = `# Claude Session Workspace

This is a session-specific workspace directory for Claude.

## Session Information
- Session ID: ${sessionId}
- Created: ${new Date().toISOString()}
- Directory: ${sessionWorkspaceDir}

## Usage
- This workspace is isolated to this session
- All files created by Claude will be stored here
- The workspace persists until the session ends
`;
    await fs.writeFile(readmeFile, readmeContent);
    
    console.log(`Created session workspace: ${sessionWorkspaceDir}`);
    return { sessionId, workspaceDir: sessionWorkspaceDir };
  } catch (error) {
    console.error('Error creating session workspace:', error);
    throw error;
  }
}

// Get workspace directory for a session, create if new session
async function getSessionWorkspace(sessionId, baseWorkspaceDir) {
  if (sessionId && sessionWorkspaces.has(sessionId)) {
    // Existing session, return stored workspace
    const workspaceDir = sessionWorkspaces.get(sessionId);
    console.log(`Using existing session workspace: ${workspaceDir}`);
    return { sessionId, workspaceDir };
  } else {
    // New session, create new workspace
    const { sessionId: newSessionId, workspaceDir } = await createSessionWorkspace(baseWorkspaceDir);
    sessionWorkspaces.set(newSessionId, workspaceDir);
    console.log(`Created new session workspace: ${workspaceDir}`);
    return { sessionId: newSessionId, workspaceDir };
  }
}

// Initialize workspace on startup
let baseWorkspaceDir; // Base workspace directory for all sessions
initializeWorkspace()
  .then((dir) => {
    baseWorkspaceDir = dir;

    // Set Claude Agent SDK configuration globally
    process.env.CLAUDE_AUTO_APPROVE_PERMISSIONS = 'true';
    process.env.CLAUDE_PERMISSION_MODE = 'auto';
  })
  .catch((error) => {
    console.error('Failed to initialize workspace:', error);
    process.exit(1);
  });

// Middleware
app.use(cors());

app.use(
  express.json({
    limit: '50mb'
  })
);

// Serve static files from the React app build directory
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
  const hasValidApiKey =
    process.env.ANTHROPIC_API_KEY &&
    process.env.ANTHROPIC_API_KEY !== 'your_api_key_here' &&
    process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-');

  let workspaceInfo = { exists: false, path: WORKSPACE_DIR };
  try {
    if (baseWorkspaceDir) {
      const files = await fs.readdir(baseWorkspaceDir);
      const stats = await fs.stat(baseWorkspaceDir);
      workspaceInfo = {
        exists: true,
        path: baseWorkspaceDir,
        configured: WORKSPACE_DIR,
        fileCount: files.length,
        files: files.slice(0, 10), // Show first 10 files
        permissions: {
          readable: true,
          writable: true
        },
        lastModified: stats.mtime,
        isConfigured: baseWorkspaceDir === path.resolve(WORKSPACE_DIR),
        sessionCount: sessionWorkspaces.size
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

    // Set headers for Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type'
    });

    // Send initial connection message
    res.write(`data: {"type": "start", "message": "Connected"}\n\n`);

    // Set environment for Claude Agent SDK workspace
    const originalEnv = process.env.CLAUDE_WORKSPACE_DIR;
    const originalCwd = process.cwd();
    const isDebugMode =
      process.env.DEBUG === '1' || process.env.DEBUG === 'true';

    try {
      try {
        // Get or create session-specific workspace
        const { sessionId: currentSessionId, workspaceDir: sessionWorkspaceDir } = await getSessionWorkspace(sessionId, baseWorkspaceDir);

        // Set the workspace directory for Claude Agent SDK
        process.env.CLAUDE_WORKSPACE_DIR = sessionWorkspaceDir;

        // Change working directory to workspace for the SDK call
        if (sessionWorkspaceDir && sessionWorkspaceDir !== process.cwd()) {
          process.chdir(sessionWorkspaceDir);
        }

        let messageCount = 0;
        let finalSessionId = currentSessionId; // Use the session ID from workspace creation

        const options = {
          cwd: sessionWorkspaceDir || process.cwd(),
          mcpServers: MCP_SERVERS,
          permissionPromptToolName: 'mcp__permission-prompt__permission_prompt',
          permissionMode: 'default',
          additionalDirectories: [sessionWorkspaceDir]
        };

        // Add session resume option if sessionId is provided (existing session)
        if (sessionId) {
          options.resume = sessionId;
          if (isDebugMode) {
            console.log('🔄 Resuming Claude SDK session with ID:', sessionId);
          }
        } else {
          if (isDebugMode) {
            console.log('🆕 Starting new Claude SDK session with workspace:', sessionWorkspaceDir);
          }
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
              keys:
                message && typeof message === 'object'
                  ? Object.keys(message)
                  : [],
              preview:
                typeof message === 'string'
                  ? message.substring(0, 100) + '...'
                  : JSON.stringify(message).substring(0, 200) + '...'
            });
          }

          // Check for Claude SDK session init messages
          if (
            message &&
            typeof message === 'object' &&
            message.type === 'system' &&
            message.subtype === 'init' &&
            message.session_id
          ) {
            const claudeSessionId = message.session_id;
            // If this is a new session, update our session workspace mapping
            if (!sessionId) {
              // New session: map Claude's session ID to our workspace
              sessionWorkspaces.set(claudeSessionId, sessionWorkspaceDir);
              finalSessionId = claudeSessionId;
              if (isDebugMode) {
                console.log(
                  '🆔 New Claude SDK session initialized with ID:',
                  claudeSessionId,
                  'workspace:',
                  sessionWorkspaceDir
                );
              }
            } else {
              // Existing session: verify mapping
              finalSessionId = claudeSessionId;
              if (isDebugMode) {
                console.log(
                  '🔄 Claude SDK session resumed with ID:',
                  claudeSessionId
                );
              }
            }
          }

          // Handle different message formats from the Claude Agent SDK
          let content = '';
          let shouldSend = false;

          if (typeof message === 'string') {
            if (isDebugMode)
              console.log(
                '📝 Processing string message:',
                message.substring(0, 100) + '...'
              );
            content = message;
            shouldSend = true;
          } else if (message && typeof message === 'object') {
            // Handle structured Claude Agent SDK responses
            if (message.type === 'assistant' && message.message) {
              if (isDebugMode) {
                console.log('🤖 Assistant message detected:', {
                  hasContent: !!message.message.content,
                  contentType: Array.isArray(message.message.content)
                    ? 'array'
                    : typeof message.message.content,
                  contentLength: message.message.content?.length
                });
              }
              // Extract content from assistant messages
              if (
                message.message.content &&
                Array.isArray(message.message.content)
              ) {
                const textItems = message.message.content.filter(
                  (item) => item.type === 'text'
                );
                if (isDebugMode)
                  console.log('🔤 Text items found:', textItems.length);
                content = textItems.map((item) => item.text).join('\n');
                shouldSend = content.length > 0;
                if (isDebugMode)
                  console.log('📄 Extracted content length:', content.length);
              }
            } else if (message.type === 'result' && message.result) {
              if (isDebugMode)
                console.log('🏁 Result message detected, skipping (redundant)');
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
              if (isDebugMode)
                console.log('❓ Unknown message format, skipping');
            }
          }

          if (isDebugMode) {
            console.log('🚦 Send decision:', {
              shouldSend,
              contentLength: content?.length,
              trimmedLength: content?.trim()?.length
            });
          }

          // Only send non-empty content
          if (shouldSend && content && content.trim().length > 0) {
            if (isDebugMode)
              console.log(
                '📤 Sending content to client:',
                content.substring(0, 100) + '...'
              );
            const eventData = {
              type: 'message',
              content: content,
              messageId: messageCount
            };

            res.write(`data: ${JSON.stringify(eventData)}\n\n`);
          } else {
            if (isDebugMode)
              console.log('⏭️  Skipping message (empty or shouldSend=false)');
          }
        }

        console.log(
          `✅ Claude SDK query completed. Total messages processed: ${messageCount}`
        );

        // Send completion message with session_id
        const completionData = {
          type: 'complete',
          message: 'Stream complete'
        };

        if (finalSessionId) {
          completionData.sessionId = finalSessionId;
          if (isDebugMode) {
            console.log('📤 Sending session_id to frontend:', finalSessionId);
          }
        }

        res.write(`data: ${JSON.stringify(completionData)}\n\n`);
        res.end();
      } finally {
        if (isDebugMode)
          console.log(
            '🧹 Cleaning up: restoring environment and working directory'
          );
        // Restore original environment and working directory
        process.env.CLAUDE_WORKSPACE_DIR = originalEnv;
        if (process.cwd() !== originalCwd) {
          process.chdir(originalCwd);
          if (isDebugMode)
            console.log('📁 Working directory restored to:', originalCwd);
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
    const { prompt, sessionId } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    let fullResponse = '';
    let finalSessionId = null;
    // Set environment for Claude Agent SDK workspace
    const originalEnv = process.env.CLAUDE_WORKSPACE_DIR;
    const originalCwd = process.cwd();

    try {
      // Get or create session-specific workspace
      const { sessionId: currentSessionId, workspaceDir: sessionWorkspaceDir } = await getSessionWorkspace(sessionId, baseWorkspaceDir);
      finalSessionId = currentSessionId;

      // Set the workspace directory for Claude Agent SDK
      process.env.CLAUDE_WORKSPACE_DIR = sessionWorkspaceDir;

      // Change working directory to workspace for the SDK call
      if (sessionWorkspaceDir && sessionWorkspaceDir !== process.cwd()) {
        process.chdir(sessionWorkspaceDir);
      }

      const options = {
        cwd: sessionWorkspaceDir || process.cwd(),
        permissionPromptToolName: 'mcp__permission-prompt__permission_prompt',
        permissionMode: 'default',
        mcpServers: MCP_SERVERS,
        additionalDirectories: [sessionWorkspaceDir]
      };

      // Add session resume option if sessionId is provided (existing session)
      if (sessionId) {
        options.resume = sessionId;
        console.log('🔄 Resuming Claude SDK session with ID:', sessionId);
      } else {
        console.log('🆕 Starting new Claude SDK session with workspace:', sessionWorkspaceDir);
      }
      console.log('🔧 Query options:', {
        prompt: prompt.substring(0, 50) + '...',
        options
      });
      for await (const message of query({
        prompt,
        options
      })) {
        // Check for Claude SDK session init messages
        if (
          message &&
          typeof message === 'object' &&
          message.type === 'system' &&
          message.subtype === 'init' &&
          message.session_id
        ) {
          const claudeSessionId = message.session_id;
          // If this is a new session, update our session workspace mapping
          if (!sessionId) {
            // New session: map Claude's session ID to our workspace
            sessionWorkspaces.set(claudeSessionId, sessionWorkspaceDir);
            finalSessionId = claudeSessionId;
            console.log(
              '🆔 New Claude SDK session initialized with ID:',
              claudeSessionId,
              'workspace:',
              sessionWorkspaceDir
            );
          } else {
            // Existing session: verify mapping
            finalSessionId = claudeSessionId;
            console.log(
              '🔄 Claude SDK session resumed with ID:',
              claudeSessionId
            );
          }
        }

        // Handle different message formats from the Claude Agent SDK
        if (typeof message === 'string') {
          fullResponse += message;
        } else if (message && typeof message === 'object') {
          // Handle structured Claude Agent SDK responses
          if (message.type === 'assistant' && message.message) {
            // Extract content from assistant messages
            if (
              message.message.content &&
              Array.isArray(message.message.content)
            ) {
              const textContent = message.message.content
                .filter((item) => item.type === 'text')
                .map((item) => item.text)
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

    const responseData = {
      response: fullResponse,
      timestamp: new Date().toISOString()
    };

    if (finalSessionId) {
      responseData.sessionId = finalSessionId;
      console.log('📤 Sending session_id to frontend:', finalSessionId);
    }

    res.json(responseData);
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

// WebSocket setup for real-time permission updates
const wss = new WebSocket.Server({ server, path: '/api/permissions/ws' });

// Generate unique client ID
function generateClientId() {
  return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

wss.on('connection', (ws, req) => {
  const clientId = generateClientId();
  console.log(`🔗 WebSocket client connected: ${clientId}`);

  // Store client with unique ID to prevent mixing
  permissionClients.set(clientId, ws);
  console.log(
    `🔗 Added client to permission stream. Total clients: ${permissionClients.size}`
  );

  // Send initial connection message
  ws.send(
    JSON.stringify({
      type: 'connected',
      message: 'Permission WebSocket connected',
      clientId: clientId
    })
  );

  // Send current pending permissions
  const pending = Array.from(pendingPermissions.values());
  if (pending.length > 0) {
    ws.send(
      JSON.stringify({ type: 'pending-permissions', permissions: pending })
    );
  }

  // Permission event handlers for this specific client
  const onPermissionRequest = (permission) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'permission-request', permission }));
    }
  };

  const onPermissionResponse = (response) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'permission-response', response }));
    }
  };

  // Add event listeners
  permissionEmitter.on('permission-request', onPermissionRequest);
  permissionEmitter.on('permission-response', onPermissionResponse);

  // Handle WebSocket messages (if needed for future functionality)
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log(`📨 Received WebSocket message from ${clientId}:`, data);
      // Handle client messages if needed
    } catch (error) {
      console.error(
        `❌ Error parsing WebSocket message from ${clientId}:`,
        error
      );
    }
  });

  // Clean up when client disconnects
  ws.on('close', () => {
    permissionClients.delete(clientId);
    console.log(
      `🔗 WebSocket client disconnected: ${clientId}. Total clients: ${permissionClients.size}`
    );
    permissionEmitter.removeListener('permission-request', onPermissionRequest);
    permissionEmitter.removeListener(
      'permission-response',
      onPermissionResponse
    );
  });

  // Handle WebSocket errors
  ws.on('error', (error) => {
    console.error(`❌ WebSocket error for client ${clientId}:`, error);
    permissionClients.delete(clientId);
    permissionEmitter.removeListener('permission-request', onPermissionRequest);
    permissionEmitter.removeListener(
      'permission-response',
      onPermissionResponse
    );
  });
});

// MCP permission request endpoint
app.post('/api/permissions/request-mcp', async (req, res) => {
  try {
    const { action, description, resource, details } = req.body;

    if (!action || !description) {
      return res
        .status(400)
        .json({ error: 'Action and description are required' });
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

    console.log(
      `🔐 Broadcasting MCP permission to ${permissionClients.size} connected clients`
    );

    // Emit event for real-time updates
    permissionEmitter.emit('permission-request', permissionRequest);

    // Wait for user response with timeout
    const response = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingPermissions.delete(permissionId);
        console.log(`⏰ MCP Permission ${permissionId} timed out - denying`);
        resolve({
          approved: false,
          reason: 'Request timed out after 60 seconds'
        });
      }, 60000); // 60 second timeout

      const responseHandler = (response) => {
        if (response.id === permissionId) {
          clearTimeout(timeout);
          pendingPermissions.delete(permissionId);
          permissionEmitter.removeListener(
            'permission-response',
            responseHandler
          );
          console.log(
            `${response.approved ? '✅' : '❌'} MCP Permission ${permissionId} ${response.approved ? 'approved' : 'denied'}`
          );
          resolve({ approved: response.approved, reason: response.reason });
        }
      };

      permissionEmitter.on('permission-response', responseHandler);
    });

    res.json(response);
  } catch (error) {
    console.error('Error processing MCP permission request:', error);
    res
      .status(500)
      .json({
        error: 'Internal server error',
        approved: false,
        reason: 'Server error'
      });
  }
});

// Permission request endpoint (legacy - for manual testing)
app.post('/api/permissions/request', async (req, res) => {
  try {
    const { action, description, details } = req.body;

    if (!action || !description) {
      return res
        .status(400)
        .json({ error: 'Action and description are required' });
    }

    console.log(`\n🔐 PERMISSION REQUEST:`);
    console.log(`Action: ${action}`);
    console.log(`Description: ${description}`);
    if (details) {
      console.log(`Details: ${JSON.stringify(details, null, 2)}`);
    }
    console.log(`Workspace: ${baseWorkspaceDir || process.cwd()}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(
      `\n⚠️  This action requires user approval. Automatically approving for web interface.`
    );

    // For the web interface, we'll auto-approve but log the request
    // In a production environment, you might want to implement actual approval flow
    res.json({
      approved: true,
      message: 'Permission automatically granted for web interface',
      action,
      description,
      workspace: baseWorkspaceDir || process.cwd(),
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

server.listen(PORT, () => {
  console.log(`Claude Code Web Application running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(
    `Permission WebSocket: ws://localhost:${PORT}/api/permissions/ws`
  );
  console.log(`API key configured: ${!!process.env.ANTHROPIC_API_KEY}`);
  console.log(`Base workspace directory: ${baseWorkspaceDir || WORKSPACE_DIR}`);
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
