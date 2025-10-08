export interface ClaudeMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
}

export interface ClaudeServiceConfig {
  baseUrl?: string;
}

interface StreamEvent {
  type: 'start' | 'message' | 'complete' | 'error';
  content?: string;
  message?: string;
  error?: string;
  messageId?: number;
  sessionId?: string;
}

class ClaudeService {
  private baseUrl: string;

  constructor(config: ClaudeServiceConfig = {}) {
    this.baseUrl = config.baseUrl || '/api';
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/status`);
      const data = await response.json();
      return data.connected === true;
    } catch (error) {
      console.error('Error testing connection:', error);
      return false;
    }
  }

  async *sendMessage(
    prompt: string,
    sessionId?: string
  ): AsyncGenerator<{ content: string; sessionId?: string }, void, unknown> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt,
          ...(sessionId && { sessionId })
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const eventData: StreamEvent = JSON.parse(line.slice(6));

                if (eventData.type === 'message' && eventData.content) {
                  yield { content: eventData.content };
                } else if (eventData.type === 'complete') {
                  if (eventData.sessionId) {
                    yield { content: '', sessionId: eventData.sessionId };
                  }
                  return;
                } else if (eventData.type === 'error') {
                  throw new Error(eventData.error || 'Unknown streaming error');
                }
              } catch (parseError) {
                console.warn('Failed to parse SSE data:', line, parseError);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      console.error('Error sending message to Claude:', error);
      throw error;
    }
  }

  async sendSingleMessage(prompt: string): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.response || '';
    } catch (error) {
      console.error('Error sending single message to Claude:', error);
      throw error;
    }
  }
}

export default ClaudeService;
