/**
 * Shared Utilities Module
 * Common utility functions and helpers
 */

class EnvironmentManager {
  constructor() {
    this.originalEnv = null;
    this.originalCwd = null;
  }

  backup() {
    this.originalEnv = process.env.CLAUDE_WORKSPACE_DIR;
    this.originalCwd = process.cwd();
  }

  setWorkspace(workspaceDir) {
    process.env.CLAUDE_WORKSPACE_DIR = workspaceDir;
    // Don't change working directory - let Claude Agent SDK handle workspace isolation
  }

  restore() {
    if (this.originalEnv !== null) {
      process.env.CLAUDE_WORKSPACE_DIR = this.originalEnv;
    }
    // Working directory restoration not needed since we don't change it
  }
}

class MessageProcessor {
  static processClaudeMessage(message, isDebugMode = false, messageCount = 0) {
    let content = '';
    let shouldSend = false;

    if (typeof message === 'string') {
      if (isDebugMode) {
        console.log('📝 Processing string message:', message.substring(0, 100) + '...');
      }
      content = message;
      shouldSend = true;
    } else if (message && typeof message === 'object') {
      if (message.type === 'assistant' && message.message) {
        if (isDebugMode) {
          console.log('🤖 Assistant message detected:', {
            hasContent: !!message.message.content,
            contentType: Array.isArray(message.message.content) ? 'array' : typeof message.message.content,
            contentLength: message.message.content?.length
          });
        }
        
        if (message.message.content && Array.isArray(message.message.content)) {
          const textItems = message.message.content.filter(item => item.type === 'text');
          if (isDebugMode) console.log('🔤 Text items found:', textItems.length);
          content = textItems.map(item => item.text).join('\n');
          shouldSend = content.length > 0;
          if (isDebugMode) console.log('📄 Extracted content length:', content.length);
        }
      } else if (message.type === 'result' && message.result) {
        if (isDebugMode) console.log('🏁 Result message detected, skipping (redundant)');
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
      console.log('🚦 Send decision:', {
        shouldSend,
        contentLength: content?.length,
        trimmedLength: content?.trim()?.length
      });
    }

    return {
      content,
      shouldSend: shouldSend && content && content.trim().length > 0
    };
  }

  static handleSessionInit(message, sessionId, workspaceManager, sessionWorkspaceDir, isDebugMode = false) {
    if (
      message &&
      typeof message === 'object' &&
      message.type === 'system' &&
      message.subtype === 'init' &&
      message.session_id
    ) {
      const claudeSessionId = message.session_id;
      let finalSessionId = claudeSessionId;

      if (!sessionId) {
        workspaceManager.sessionWorkspaces.set(claudeSessionId, sessionWorkspaceDir);
        finalSessionId = claudeSessionId;
        if (isDebugMode) {
          console.log('🆔 New Claude SDK session initialized with ID:', claudeSessionId, 'workspace:', sessionWorkspaceDir);
        }
      } else {
        finalSessionId = claudeSessionId;
        if (isDebugMode) {
          console.log('🔄 Claude SDK session resumed with ID:', claudeSessionId);
        }
      }

      return finalSessionId;
    }
    return null;
  }

  static logDebugMessage(message, messageCount, isDebugMode) {
    if (!isDebugMode) return;

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
}

class ConfigUtils {
  static createQueryOptions(sessionWorkspaceDir, mcpServers, sessionId, isDebugMode = false) {
    const options = {
      mcpServers,
      permissionPromptToolName: 'mcp__permission-prompt__permission_prompt',
      permissionMode: 'default',
      allowedTools: ['mcp__permission-prompt', 'mcp__deploy']
    };
    
    // Set working directory to session workspace but don't change process cwd
    if (sessionWorkspaceDir) {
      options.cwd = sessionWorkspaceDir;
      options.additionalDirectories = [sessionWorkspaceDir];
    }

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

    return options;
  }

  static checkApiKey() {
    return process.env.ANTHROPIC_API_KEY &&
           process.env.ANTHROPIC_API_KEY !== 'your_api_key_here' &&
           process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-');
  }

  static isDebugMode() {
    return process.env.DEBUG === '1' || process.env.DEBUG === 'true';
  }
}

module.exports = {
  EnvironmentManager,
  MessageProcessor,
  ConfigUtils
};