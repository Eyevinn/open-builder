import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import ClaudeService, { ClaudeMessage } from '../services/claudeService';

interface ClaudeContextType {
  messages: ClaudeMessage[];
  isLoading: boolean;
  isConnected: boolean;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
  connectToService: () => Promise<void>;
}

const ClaudeContext = createContext<ClaudeContextType | undefined>(undefined);

export const useClaudeContext = () => {
  const context = useContext(ClaudeContext);
  if (context === undefined) {
    throw new Error('useClaudeContext must be used within a ClaudeProvider');
  }
  return context;
};

interface ClaudeProviderProps {
  children: ReactNode;
}

export const ClaudeProvider: React.FC<ClaudeProviderProps> = ({ children }) => {
  const [messages, setMessages] = useState<ClaudeMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [claudeService, setClaudeService] = useState<ClaudeService | null>(null);

  const connectToService = useCallback(async () => {
    try {
      const service = new ClaudeService();
      
      // Test the connection to the server
      const isConnected = await service.testConnection();
      if (!isConnected) {
        throw new Error('Unable to connect to server');
      }
      
      setClaudeService(service);
      setIsConnected(true);
    } catch (error) {
      console.error('Failed to connect to Claude service:', error);
      setIsConnected(false);
      throw error;
    }
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!claudeService) {
      throw new Error('Claude service not connected');
    }

    const userMessage: ClaudeMessage = {
      id: Date.now().toString(),
      content,
      role: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      let assistantResponse = '';
      
      for await (const chunk of claudeService.sendMessage(content)) {
        // Add spacing between chunks if assistantResponse already has content
        if (assistantResponse.trim().length > 0 && chunk.trim().length > 0) {
          assistantResponse += '\n\n' + chunk;
        } else {
          assistantResponse += chunk;
        }
        
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          
          if (lastMessage && lastMessage.role === 'assistant') {
            lastMessage.content = assistantResponse;
          } else {
            newMessages.push({
              id: (Date.now() + 1).toString(),
              content: assistantResponse,
              role: 'assistant',
              timestamp: new Date(),
            });
          }
          
          return newMessages;
        });
      }
    } catch (error) {
      console.error('Error sending message:', error);
      
      const errorMessage: ClaudeMessage = {
        id: (Date.now() + 2).toString(),
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
        role: 'assistant',
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [claudeService]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const value: ClaudeContextType = {
    messages,
    isLoading,
    isConnected,
    sendMessage,
    clearMessages,
    connectToService,
  };

  return (
    <ClaudeContext.Provider value={value}>
      {children}
    </ClaudeContext.Provider>
  );
};