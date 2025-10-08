/**
 * Workspace Management Module
 * Handles session-based workspace isolation and initialization
 */

const fs = require('fs-extra');
const path = require('path');

class WorkspaceManager {
  constructor() {
    this.sessionWorkspaces = new Map();
    this.baseWorkspaceDir = null;
  }

  async initializeWorkspace(workspaceDir = './usercontent') {
    try {
      const absoluteWorkspaceDir = path.resolve(workspaceDir);
      await fs.ensureDir(absoluteWorkspaceDir);

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

      this.baseWorkspaceDir = absoluteWorkspaceDir;
      return absoluteWorkspaceDir;
    } catch (error) {
      console.error('Error initializing workspace:', error);
      throw error;
    }
  }

  async createSessionWorkspace(baseWorkspaceDir) {
    try {
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const sessionWorkspaceDir = path.join(baseWorkspaceDir, sessionId);
      
      await fs.ensureDir(sessionWorkspaceDir);
      
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

  async getSessionWorkspace(sessionId, baseWorkspaceDir) {
    if (sessionId && this.sessionWorkspaces.has(sessionId)) {
      const workspaceDir = this.sessionWorkspaces.get(sessionId);
      console.log(`Using existing session workspace: ${workspaceDir}`);
      return { sessionId, workspaceDir };
    } else {
      const { sessionId: newSessionId, workspaceDir } = await this.createSessionWorkspace(baseWorkspaceDir);
      this.sessionWorkspaces.set(newSessionId, workspaceDir);
      console.log(`Created new session workspace: ${workspaceDir}`);
      return { sessionId: newSessionId, workspaceDir };
    }
  }

  getBaseWorkspaceDir() {
    return this.baseWorkspaceDir;
  }

  getSessionCount() {
    return this.sessionWorkspaces.size;
  }

  getAllSessions() {
    return Array.from(this.sessionWorkspaces.entries());
  }
}

module.exports = WorkspaceManager;