/**
 * WebSocket Management Module
 * Handles WebSocket connections for real-time permission updates
 */

const WebSocket = require('ws');

class WebSocketManager {
  constructor(server, permissionManager) {
    this.permissionManager = permissionManager;
    this.wss = new WebSocket.Server({ server, path: '/api/permissions/ws' });
    this.setupWebSocketServer();
  }

  setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      const clientId = this.permissionManager.generateClientId();
      console.log(`🔗 WebSocket client connected: ${clientId}`);

      this.permissionManager.addClient(clientId, ws);

      this.sendConnectionMessage(ws, clientId);
      this.sendPendingPermissions(ws);

      const handlers = this.createEventHandlers(ws, clientId);
      this.addEventListeners(handlers);
      this.setupWebSocketHandlers(ws, clientId, handlers);
    });
  }

  sendConnectionMessage(ws, clientId) {
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Permission WebSocket connected',
      clientId: clientId
    }));
  }

  sendPendingPermissions(ws) {
    const pending = this.permissionManager.getPendingPermissions();
    if (pending.length > 0) {
      ws.send(JSON.stringify({ 
        type: 'pending-permissions', 
        permissions: pending 
      }));
    }
  }

  createEventHandlers(ws, clientId) {
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

    return { onPermissionRequest, onPermissionResponse };
  }

  addEventListeners(handlers) {
    this.permissionManager.on('permission-request', handlers.onPermissionRequest);
    this.permissionManager.on('permission-response', handlers.onPermissionResponse);
  }

  removeEventListeners(handlers) {
    this.permissionManager.removeListener('permission-request', handlers.onPermissionRequest);
    this.permissionManager.removeListener('permission-response', handlers.onPermissionResponse);
  }

  setupWebSocketHandlers(ws, clientId, handlers) {
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log(`📨 Received WebSocket message from ${clientId}:`, data);
      } catch (error) {
        console.error(`❌ Error parsing WebSocket message from ${clientId}:`, error);
      }
    });

    ws.on('close', () => {
      this.permissionManager.removeClient(clientId);
      this.removeEventListeners(handlers);
    });

    ws.on('error', (error) => {
      console.error(`❌ WebSocket error for client ${clientId}:`, error);
      this.permissionManager.removeClient(clientId);
      this.removeEventListeners(handlers);
    });
  }
}

module.exports = WebSocketManager;