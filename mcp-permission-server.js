#!/usr/bin/env node

/**
 * MCP Permission Server
 *
 * This MCP server provides permission prompt tools that Claude can use
 * to request permissions from the user through the web application.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  StdioServerTransport
} = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');
// Import fetch function - handle different environments
let fetch;

async function initializeFetch() {
  try {
    // Try to use native fetch if available (Node.js 18+)
    if (global.fetch) {
      fetch = global.fetch;
      console.error('🔐 Using native fetch function');
    } else {
      // Fall back to node-fetch for older Node.js versions
      // node-fetch v3+ is ESM, so we need dynamic import
      const nodeFetch = await import('node-fetch');
      fetch = nodeFetch.default || nodeFetch;
      console.error('🔐 Using node-fetch library');
    }
  } catch (err) {
    console.error('🔐 Error: Could not load fetch function:', err.message);
    process.exit(1);
  }
}

// Initialize fetch before starting server
initializeFetch()
  .then(() => {
    console.error('🔐 Fetch function initialized successfully');
  })
  .catch((err) => {
    console.error('🔐 Failed to initialize fetch:', err);
    process.exit(1);
  });

// Configuration
const WEB_APP_BASE_URL = `http://localhost:${process.env.PORT}`;

class PermissionMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'permission-prompt-server',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  setupToolHandlers() {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      console.error('🔐 MCP Tool listing requested');
      return {
        tools: [
          {
            name: 'permission_prompt',
            description:
              'Request permission from the user to perform an action',
            inputSchema: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  description:
                    'The action requiring permission (e.g., file_write, command_execute)'
                },
                description: {
                  type: 'string',
                  description: 'Human-readable description of what will be done'
                },
                resource: {
                  type: 'string',
                  description:
                    'The resource being accessed (file path, command, etc.)',
                  optional: true
                },
                details: {
                  type: 'object',
                  description:
                    'Additional details about the permission request',
                  optional: true
                }
              },
              required: ['action', 'description']
            }
          }
        ]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      console.error(
        '🔐 MCP Tool call received:',
        JSON.stringify(request.params, null, 2)
      );
      const { name, arguments: args } = request.params;

      if (name === 'permission_prompt') {
        console.error('🔐 Processing request_permission tool call');
        return await this.handlePermissionRequest(args);
      }

      console.error('🔐 Unknown tool requested:', name);
      throw new Error(`Unknown tool: ${name}`);
    });
  }

  async handlePermissionRequest(args) {
    // Handle different argument structures from Claude Agent SDK
    let action, description, resource, details;

    if (args.tool_name && args.input) {
      // New format from Claude Agent SDK
      action = `${args.tool_name}`;
      description = `Request to use ${args.tool_name} tool`;
      resource =
        args.input.file_path ||
        args.input.command ||
        JSON.stringify(args.input);
      details = args.input;
    } else {
      // Direct format
      action = args.action;
      description = args.description;
      resource = args.resource;
      details = args.details;
    }

    console.error(`🔐 MCP Permission Request: ${action} - ${description}`);

    try {
      // Create permission request
      const permissionRequest = {
        action,
        description,
        resource,
        details,
        timestamp: new Date().toISOString()
      };

      console.error(
        `🔐 Sending permission request to web app: ${WEB_APP_BASE_URL}/api/permissions/request-mcp`
      );

      // Send permission request to web application
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 65000); // 65 second timeout

      const response = await fetch(
        `${WEB_APP_BASE_URL}/api/permissions/request-mcp`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(permissionRequest),
          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Permission request failed: ${error}`);
      }

      const result = await response.json();

      console.error(
        `🔐 MCP Response received:`,
        JSON.stringify(result, null, 2)
      );

      // Validate the response structure
      if (!result || typeof result !== 'object') {
        throw new Error(
          `Invalid response format: expected object, got ${typeof result}`
        );
      }

      if (typeof result.approved !== 'boolean') {
        throw new Error(
          `Invalid response: 'approved' field must be boolean, got ${typeof result.approved}`
        );
      }

      console.error(
        `🔐 Permission ${result.approved ? 'approved' : 'denied'}: ${result.reason || 'No reason provided'}`
      );

      // Return Claude Agent SDK compatible response format
      const permissionResponse = {
        behavior: result.approved ? 'allow' : 'deny',
        message: result.approved
          ? `Permission approved: ${description}. You may proceed with the action.`
          : `Permission denied: ${description}. Reason: ${result.reason || 'User denied the request'}`
      };

      // For approved permissions, we can optionally include updatedInput if we want to modify the input
      if (result.approved && details && details.file_path) {
        // Override SDK permission suggestions: redirect /tmp paths to workspace directory
        const workspaceDir = process.env.WEB_APP_BASE_URL
          ? process.env.CLAUDE_WORKSPACE_DIR || './usercontent'
          : './usercontent';

        let modifiedFilePath = details.file_path;

        // Check if the file path is in /tmp and redirect it to workspace
        if (
          details.file_path.startsWith('/tmp/') ||
          details.file_path.startsWith('/tmp\\')
        ) {
          // Extract the filename from the /tmp path
          const fileName = details.file_path.replace(/^\/tmp[\/\\]?/, '');

          // Create new path in workspace directory
          if (fileName) {
            // If workspaceDir is relative, resolve it relative to the server process
            const path = require('path');
            const absoluteWorkspaceDir = path.isAbsolute(workspaceDir)
              ? workspaceDir
              : path.resolve(process.cwd(), workspaceDir);

            modifiedFilePath = path.join(absoluteWorkspaceDir, fileName);
            console.error(
              `🔐 Redirecting file path from ${details.file_path} to ${modifiedFilePath}`
            );
          }
        }

        // Include the modified input
        permissionResponse.updatedInput = {
          ...details,
          file_path: modifiedFilePath
        };
      }

      console.error(
        `🔐 Returning permission response:`,
        JSON.stringify(permissionResponse, null, 2)
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(permissionResponse)
          }
        ]
      };
    } catch (error) {
      console.error(`🔐 Permission request error:`, error);
      console.error(`🔐 Error details:`, {
        message: error.message,
        stack: error.stack,
        name: error.name
      });

      // Return Claude Agent SDK compatible error response format
      const errorPermissionResponse = {
        behavior: 'deny',
        message: `Permission request failed: ${error.message}. Assuming permission denied for safety.`
      };

      const errorResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(errorPermissionResponse)
          }
        ]
      };

      console.error(
        `🔐 Returning error response:`,
        JSON.stringify(errorResponse, null, 2)
      );
      return errorResponse;
    }
  }

  setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Permission Server Error]:', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('🔐 MCP Permission Server running on stdio');
    console.error('🔐 Web app URL:', WEB_APP_BASE_URL);
  }
}

// Create and run the server
const server = new PermissionMCPServer();
server.run().catch((error) => {
  console.error('Failed to run MCP Permission Server:', error);
  process.exit(1);
});
