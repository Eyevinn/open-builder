/**
 * Chat Processing Module
 * Handles Claude SDK interactions and message processing
 */

const { query } = require('@anthropic-ai/claude-agent-sdk');
const { EnvironmentManager, MessageProcessor, ConfigUtils } = require('./utils');

class ChatProcessor {
  constructor(workspaceManager) {
    this.workspaceManager = workspaceManager;
  }

  async processStreamingChat(prompt, sessionId, res, mcpServers) {
    const envManager = new EnvironmentManager();
    const isDebugMode = ConfigUtils.isDebugMode();

    envManager.backup();

    try {
      const { sessionId: currentSessionId, workspaceDir: sessionWorkspaceDir } = 
        await this.workspaceManager.getSessionWorkspace(sessionId, this.workspaceManager.getBaseWorkspaceDir());

      envManager.setWorkspace(sessionWorkspaceDir);

      let messageCount = 0;
      let finalSessionId = currentSessionId;

      const options = ConfigUtils.createQueryOptions(sessionWorkspaceDir, mcpServers, sessionId, isDebugMode);

      if (isDebugMode) {
        console.log('🔧 Query options:', {
          prompt: prompt.substring(0, 50) + '...',
          options
        });
      }

      for await (const message of query({ prompt, options })) {
        messageCount++;

        MessageProcessor.logDebugMessage(message, messageCount, isDebugMode);

        const sessionIdUpdate = MessageProcessor.handleSessionInit(
          message, 
          sessionId, 
          this.workspaceManager, 
          sessionWorkspaceDir, 
          isDebugMode
        );
        
        if (sessionIdUpdate) {
          finalSessionId = sessionIdUpdate;
        }

        const { content, shouldSend } = MessageProcessor.processClaudeMessage(message, isDebugMode, messageCount);

        if (shouldSend) {
          if (isDebugMode) {
            console.log('📤 Sending content to client:', content.substring(0, 100) + '...');
          }
          const eventData = {
            type: 'message',
            content: content,
            messageId: messageCount
          };
          res.write(`data: ${JSON.stringify(eventData)}\n\n`);
        } else {
          if (isDebugMode) {
            console.log('⏭️  Skipping message (empty or shouldSend=false)');
          }
        }
      }

      console.log(`✅ Claude SDK query completed. Total messages processed: ${messageCount}`);

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
      if (isDebugMode) {
        console.log('🧹 Cleaning up: restoring environment and working directory');
      }
      envManager.restore();
    }
  }

  async processRegularChat(prompt, sessionId, mcpServers) {
    const envManager = new EnvironmentManager();
    envManager.backup();

    try {
      const { sessionId: currentSessionId, workspaceDir: sessionWorkspaceDir } = 
        await this.workspaceManager.getSessionWorkspace(sessionId, this.workspaceManager.getBaseWorkspaceDir());

      envManager.setWorkspace(sessionWorkspaceDir);

      let fullResponse = '';
      let finalSessionId = currentSessionId;

      const options = ConfigUtils.createQueryOptions(sessionWorkspaceDir, mcpServers, sessionId);

      console.log('🔧 Query options:', {
        prompt: prompt.substring(0, 50) + '...',
        options
      });

      for await (const message of query({ prompt, options })) {
        const sessionIdUpdate = MessageProcessor.handleSessionInit(
          message, 
          sessionId, 
          this.workspaceManager, 
          sessionWorkspaceDir
        );
        
        if (sessionIdUpdate) {
          finalSessionId = sessionIdUpdate;
        }

        if (typeof message === 'string') {
          fullResponse += message;
        } else if (message && typeof message === 'object') {
          if (message.type === 'assistant' && message.message) {
            if (message.message.content && Array.isArray(message.message.content)) {
              const textContent = message.message.content
                .filter((item) => item.type === 'text')
                .map((item) => item.text)
                .join('\n');
              if (textContent && textContent.trim().length > 0) {
                fullResponse += textContent;
              }
            }
          } else if (message.type === 'result' && message.result) {
            // Skip final result messages as they're redundant
          } else if (message.content) {
            fullResponse += message.content;
          } else if (message.text) {
            fullResponse += message.text;
          }
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

      return responseData;

    } finally {
      envManager.restore();
    }
  }
}

module.exports = ChatProcessor;