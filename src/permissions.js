/**
 * Permission Management Module
 * Handles permission requests, responses, and WebSocket communication
 */

const EventEmitter = require('events');

class PermissionManager extends EventEmitter {
  constructor() {
    super();
    this.pendingPermissions = new Map();
    this.permissionClients = new Map();
  }

  getPendingPermissions() {
    return Array.from(this.pendingPermissions.values());
  }

  addPermissionRequest(permissionRequest) {
    this.pendingPermissions.set(permissionRequest.id, permissionRequest);
    this.emit('permission-request', permissionRequest);
  }

  respondToPermission(permissionId, approved, reason) {
    const permission = this.pendingPermissions.get(permissionId);
    if (!permission) {
      return { success: false, error: 'Permission request not found or already processed' };
    }

    const response = {
      id: permissionId,
      approved,
      reason: reason || (approved ? 'Approved by user' : 'Denied by user'),
      timestamp: new Date().toISOString()
    };

    this.emit('permission-response', response);

    return {
      success: true,
      message: `Permission ${approved ? 'approved' : 'denied'}`,
      permissionId,
      approved
    };
  }

  async requestMcpPermission(action, description, resource, details) {
    if (!action || !description) {
      throw new Error('Action and description are required');
    }

    const permissionId = `mcp_perm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(`🔐 MCP Permission requested: ${action} - ${description}`);

    const permissionRequest = {
      id: permissionId,
      action,
      description,
      resource,
      details,
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    this.addPermissionRequest(permissionRequest);

    console.log(`🔐 Broadcasting MCP permission to ${this.permissionClients.size} connected clients`);

    const response = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingPermissions.delete(permissionId);
        console.log(`⏰ MCP Permission ${permissionId} timed out - denying`);
        resolve({
          approved: false,
          reason: 'Request timed out after 60 seconds'
        });
      }, 60000);

      const responseHandler = (response) => {
        if (response.id === permissionId) {
          clearTimeout(timeout);
          this.pendingPermissions.delete(permissionId);
          this.removeListener('permission-response', responseHandler);
          console.log(
            `${response.approved ? '✅' : '❌'} MCP Permission ${permissionId} ${response.approved ? 'approved' : 'denied'}`
          );
          resolve({ approved: response.approved, reason: response.reason });
        }
      };

      this.on('permission-response', responseHandler);
    });

    return response;
  }

  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  addClient(clientId, ws) {
    this.permissionClients.set(clientId, ws);
    console.log(`🔗 Added client to permission stream. Total clients: ${this.permissionClients.size}`);
  }

  removeClient(clientId) {
    this.permissionClients.delete(clientId);
    console.log(`🔗 WebSocket client disconnected: ${clientId}. Total clients: ${this.permissionClients.size}`);
  }

  getClientCount() {
    return this.permissionClients.size;
  }

  broadcastToClients(message) {
    this.permissionClients.forEach((ws, clientId) => {
      try {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(JSON.stringify(message));
        }
      } catch (error) {
        console.error(`Error broadcasting to client ${clientId}:`, error);
        this.removeClient(clientId);
      }
    });
  }
}

module.exports = PermissionManager;