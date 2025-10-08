/**
 * PermissionModal Component - Permission management interface
 * Copyright (c) 2024 Eyevinn Technology AB
 * Licensed under the MIT License
 */

import React, { useState, useEffect } from 'react';
import './PermissionModal.css';

interface Permission {
  id: string;
  action: string;
  description: string;
  details: any;
  timestamp: string;
  status: string;
}

interface PermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  autoOpened?: boolean; // Indicates if modal was opened automatically vs manually
}

const PermissionModal: React.FC<PermissionModalProps> = ({
  isOpen,
  onClose,
  autoOpened = false
}) => {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [webSocket, setWebSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (isOpen && !webSocket) {
      // Connect to permission WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/permissions/ws`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('Permission WebSocket connected');
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'connected':
              console.log('Connected to permission WebSocket');
              break;

            case 'pending-permissions':
              setPermissions(data.permissions || []);
              break;

            case 'permission-request':
              setPermissions((prev) => [...prev, data.permission]);
              break;

            case 'permission-response':
              setPermissions((prev) =>
                prev.filter((p) => p.id !== data.response.id)
              );
              break;

            default:
              console.log('Unknown permission event type:', data.type);
          }
        } catch (error) {
          console.error('Error parsing permission WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('Permission WebSocket error:', error);
        setIsConnected(false);
      };

      ws.onclose = () => {
        console.log('Permission WebSocket closed');
        setIsConnected(false);
      };

      setWebSocket(ws);
    }

    return () => {
      if (webSocket && webSocket.readyState === WebSocket.OPEN) {
        webSocket.close();
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen && webSocket) {
      webSocket.close();
      setWebSocket(null);
      setIsConnected(false);
      setPermissions([]);
    }
  }, [isOpen]);

  // Auto-close modal when no permissions remain (only if it was auto-opened)
  useEffect(() => {
    if (isOpen && permissions.length === 0 && isConnected && autoOpened) {
      // Small delay to allow for smooth transition
      const timer = setTimeout(() => {
        onClose();
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [permissions.length, isOpen, isConnected, autoOpened, onClose]);

  const handleResponse = async (permissionId: string, approved: boolean) => {
    try {
      const response = await fetch('/api/permissions/respond', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          permissionId,
          approved,
          reason: approved
            ? 'Approved by user via web interface'
            : 'Denied by user via web interface'
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to respond to permission');
      }

      // Permission will be removed from list via the event stream
    } catch (error) {
      console.error('Error responding to permission:', error);
      alert(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  const getActionIcon = (action: string) => {
    switch (action.toLowerCase()) {
      case 'write':
      case 'file_write':
        return '📝';
      case 'read':
      case 'file_read':
        return '👁️';
      case 'execute':
      case 'command':
        return '⚡';
      case 'delete':
        return '🗑️';
      default:
        return '🔐';
    }
  };

  const getActionColor = (action: string) => {
    switch (action.toLowerCase()) {
      case 'write':
      case 'file_write':
        return '#f59e0b';
      case 'read':
      case 'file_read':
        return '#10b981';
      case 'execute':
      case 'command':
        return '#ef4444';
      case 'delete':
        return '#dc2626';
      default:
        return '#6b7280';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="permission-modal-overlay" onClick={onClose}>
      <div className="permission-modal" onClick={(e) => e.stopPropagation()}>
        <div className="permission-modal-header">
          <h2>Permission Requests</h2>
          <div className="connection-status">
            <span
              className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`}
            ></span>
            <span className="status-text">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="permission-modal-body">
          {permissions.length === 0 ? (
            <div className="no-permissions">
              <div className="no-permissions-icon">🔐</div>
              <h3>No Pending Permissions</h3>
              <p>
                All permission requests will appear here when Claude needs
                access to perform operations.
              </p>
            </div>
          ) : (
            <div className="permissions-list">
              {permissions.map((permission) => (
                <div key={permission.id} className="permission-item">
                  <div className="permission-header">
                    <div className="permission-icon-action">
                      <span
                        className="permission-icon"
                        style={{
                          backgroundColor: getActionColor(permission.action)
                        }}
                      >
                        {getActionIcon(permission.action)}
                      </span>
                      <div className="permission-info">
                        <h4 className="permission-action">
                          {permission.action}
                        </h4>
                        <p className="permission-description">
                          {permission.description}
                        </p>
                      </div>
                    </div>
                    <div className="permission-timestamp">
                      {new Date(permission.timestamp).toLocaleTimeString()}
                    </div>
                  </div>

                  {permission.details && (
                    <div className="permission-details">
                      <details>
                        <summary>View Details</summary>
                        <pre className="permission-details-json">
                          {JSON.stringify(permission.details, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}

                  <div className="permission-actions">
                    <button
                      className="permission-button deny"
                      onClick={() => handleResponse(permission.id, false)}
                    >
                      ❌ Deny
                    </button>
                    <button
                      className="permission-button approve"
                      onClick={() => handleResponse(permission.id, true)}
                    >
                      ✅ Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="permission-modal-footer">
          <p className="permission-note">
            <strong>Security Note:</strong> Only approve permissions you
            understand and trust. Claude will wait for your response before
            proceeding with any operations.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PermissionModal;
