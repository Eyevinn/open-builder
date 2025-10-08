/**
 * ChatInterface Component - Main chat interface for Claude interactions
 * Copyright (c) 2024 Eyevinn Technology AB
 * Licensed under the MIT License
 */

import React, { useState, useRef, useEffect } from 'react';
import { useClaudeContext } from '../contexts/ClaudeContext';
import FormattedMessage from './FormattedMessage';
import PermissionModal from './PermissionModal';
import './ChatInterface.css';

const ChatInterface: React.FC = () => {
  const { messages, isLoading, sendMessage, clearMessages } =
    useClaudeContext();
  const [inputValue, setInputValue] = useState('');
  const [isPermissionModalOpen, setIsPermissionModalOpen] = useState(false);
  const [pendingPermissionCount, setPendingPermissionCount] = useState(0);
  const [permissionWebSocket, setPermissionWebSocket] =
    useState<WebSocket | null>(null);
  const [modalAutoOpened, setModalAutoOpened] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Connect to permission events to track pending count
  useEffect(() => {
    // Request notification permission on first load
    const requestNotificationPermission = async () => {
      if ('Notification' in window && Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch (error) {
          console.log('Notification permission request failed:', error);
        }
      }
    };

    const showNotification = (permission: any) => {
      if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(
          'Permission Request - Claude Code',
          {
            body: `Claude is requesting permission: ${permission.description}`,
            icon: '/favicon.ico',
            tag: `permission-${permission.id}`,
            requireInteraction: true
          }
        );

        notification.onclick = () => {
          window.focus();
          setIsPermissionModalOpen(true);
          notification.close();
        };

        // Auto-close after 10 seconds if user doesn't interact
        setTimeout(() => {
          notification.close();
        }, 10000);
      }
    };

    const connectToPermissionEvents = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/permissions/ws`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('Permission WebSocket connected for notifications');
        requestNotificationPermission();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'pending-permissions':
              setPendingPermissionCount(data.permissions?.length || 0);
              break;

            case 'permission-request':
              setPendingPermissionCount((prev) => prev + 1);

              // Show browser notification
              showNotification(data.permission);

              // Auto-open modal for new permission requests to make them more visible
              if (!isPermissionModalOpen) {
                setIsPermissionModalOpen(true);
                setModalAutoOpened(true);
              }
              break;

            case 'permission-response':
              setPendingPermissionCount((prev) => Math.max(0, prev - 1));
              break;
          }
        } catch (error) {
          console.error(
            'Error parsing permission WebSocket message for notifications:',
            error
          );
        }
      };

      ws.onerror = (error) => {
        console.error('Permission notification WebSocket error:', error);
        // Retry connection after a delay
        setTimeout(connectToPermissionEvents, 5000);
      };

      ws.onclose = () => {
        console.log('Permission notification WebSocket closed');
        // Retry connection after a delay
        setTimeout(connectToPermissionEvents, 5000);
      };

      setPermissionWebSocket(ws);
    };

    connectToPermissionEvents();

    return () => {
      if (permissionWebSocket) {
        permissionWebSocket.close();
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && !isLoading) {
      await sendMessage(inputValue.trim());
      setInputValue('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleClearMessages = async () => {
    try {
      clearMessages();
    } catch (error) {
      console.error('Failed to clear messages:', error);
    }
  };

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <div className="chat-header-left">
          <h2>Open Builder</h2>
        </div>
        <div className="chat-header-controls">
          <button
            className="session-button clear"
            onClick={handleClearMessages}
            disabled={isLoading}
            title="Clear Messages"
          >
            🗑️ Clear
          </button>
          <button
            className={`permission-button-header ${pendingPermissionCount > 0 ? 'has-pending' : ''}`}
            onClick={() => {
              setIsPermissionModalOpen(true);
              setModalAutoOpened(false);
            }}
            title={`View Permission Requests${pendingPermissionCount > 0 ? ` (${pendingPermissionCount} pending)` : ''}`}
          >
            🔐 Permissions
            {pendingPermissionCount > 0 && (
              <span className="permission-badge">{pendingPermissionCount}</span>
            )}
          </button>
        </div>
      </div>

      <div className="messages-container">
        {messages.length === 0 && (
          <div className="welcome-message">
            <h3>Welcome to Open Builder!</h3>
            <p>
              Ask me anything about coding, get help with your projects, or
              request code generation.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id}>
            <FormattedMessage
              content={message.content}
              isUser={message.role === 'user'}
            />
            <div className="message-timestamp">
              {message.timestamp.toLocaleTimeString()}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="message assistant loading">
            <div className="message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="input-form">
        <textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask your Open Builder assistant anything..."
          disabled={isLoading}
          rows={3}
        />
        <button type="submit" disabled={isLoading || !inputValue.trim()}>
          Send
        </button>
      </form>

      <PermissionModal
        isOpen={isPermissionModalOpen}
        onClose={() => setIsPermissionModalOpen(false)}
        autoOpened={modalAutoOpened}
      />
    </div>
  );
};

export default ChatInterface;
