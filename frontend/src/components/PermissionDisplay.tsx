import React, { useState, useEffect } from 'react';
import './PermissionDisplay.css';

interface WorkspaceInfo {
  exists: boolean;
  path: string;
  configured?: string;
  fileCount?: number;
  files?: string[];
  permissions?: {
    readable: boolean;
    writable: boolean;
  };
  lastModified?: string;
  isConfigured?: boolean;
  error?: string;
}

interface HealthCheckResponse {
  status: string;
  message: string;
  hasApiKey: boolean;
  apiKeyStatus: string;
  workspace: WorkspaceInfo;
}

const PermissionDisplay: React.FC = () => {
  const [healthData, setHealthData] = useState<HealthCheckResponse | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const fetchHealthData = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/health');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setHealthData(data);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch health data'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHealthData();
    const interval = setInterval(fetchHealthData, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, []);

  if (isLoading && !healthData) {
    return (
      <div className="permission-display">
        <div className="status-header">
          <div className="status-indicator loading"></div>
          <span>Loading workspace status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="permission-display">
        <div className="status-header error">
          <div className="status-indicator error"></div>
          <span>Error: {error}</span>
          <button onClick={fetchHealthData} className="retry-button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const workspace = healthData?.workspace;
  const hasValidWorkspace = workspace?.exists && !workspace?.error;

  return (
    <div className="permission-display">
      <div
        className={`status-header ${hasValidWorkspace ? 'success' : 'warning'}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div
          className={`status-indicator ${hasValidWorkspace ? 'success' : 'warning'}`}
        ></div>
        <span className="status-text">
          Workspace: {workspace?.path || 'Not configured'}
          {workspace?.fileCount !== undefined &&
            ` (${workspace.fileCount} files)`}
        </span>
        <button className={`expand-button ${isExpanded ? 'expanded' : ''}`}>
          ▼
        </button>
      </div>

      {isExpanded && (
        <div className="status-details">
          <div className="detail-section">
            <h4>API Configuration</h4>
            <div className="detail-item">
              <span className="label">API Key:</span>
              <span
                className={`value ${healthData?.hasApiKey ? 'success' : 'error'}`}
              >
                {healthData?.apiKeyStatus || 'Not configured'}
              </span>
            </div>
          </div>

          <div className="detail-section">
            <h4>Workspace Configuration</h4>

            <div className="detail-item">
              <span className="label">Status:</span>
              <span
                className={`value ${hasValidWorkspace ? 'success' : 'error'}`}
              >
                {workspace?.exists ? 'Active' : 'Not found'}
              </span>
            </div>

            <div className="detail-item">
              <span className="label">Configured Path:</span>
              <span className="value path">
                {workspace?.configured || 'Not set'}
              </span>
            </div>

            <div className="detail-item">
              <span className="label">Resolved Path:</span>
              <span className="value path">
                {workspace?.path || 'Not resolved'}
              </span>
            </div>

            <div className="detail-item">
              <span className="label">Is Properly Configured:</span>
              <span
                className={`value ${workspace?.isConfigured ? 'success' : 'warning'}`}
              >
                {workspace?.isConfigured ? 'Yes' : 'Path mismatch'}
              </span>
            </div>

            {workspace?.permissions && (
              <>
                <div className="detail-item">
                  <span className="label">Readable:</span>
                  <span
                    className={`value ${workspace.permissions.readable ? 'success' : 'error'}`}
                  >
                    {workspace.permissions.readable ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="label">Writable:</span>
                  <span
                    className={`value ${workspace.permissions.writable ? 'success' : 'error'}`}
                  >
                    {workspace.permissions.writable ? 'Yes' : 'No'}
                  </span>
                </div>
              </>
            )}

            {workspace?.fileCount !== undefined && (
              <div className="detail-item">
                <span className="label">File Count:</span>
                <span className="value">{workspace.fileCount}</span>
              </div>
            )}

            {workspace?.lastModified && (
              <div className="detail-item">
                <span className="label">Last Modified:</span>
                <span className="value">
                  {new Date(workspace.lastModified).toLocaleString()}
                </span>
              </div>
            )}

            {workspace?.files && workspace.files.length > 0 && (
              <div className="detail-item">
                <span className="label">Recent Files:</span>
                <div className="file-list">
                  {workspace.files.map((file, index) => (
                    <span key={index} className="file-name">
                      {file}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {workspace?.error && (
              <div className="detail-item">
                <span className="label">Error:</span>
                <span className="value error">{workspace.error}</span>
              </div>
            )}
          </div>

          <div className="detail-section">
            <h4>Permissions</h4>
            <p className="permission-note">
              Claude can read and write files within the configured workspace
              directory. All file operations are sandboxed for security.
              Permission requests are automatically logged and approved for the
              web interface.
            </p>
          </div>

          <div className="actions">
            <button onClick={fetchHealthData} className="refresh-button">
              Refresh Status
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PermissionDisplay;
