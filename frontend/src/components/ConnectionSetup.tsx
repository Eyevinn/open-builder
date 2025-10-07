import React, { useState, useEffect } from 'react';
import { useClaudeContext } from '../contexts/ClaudeContext';
import './ConnectionSetup.css';

const ConnectionSetup: React.FC = () => {
  const { connectToService } = useClaudeContext();
  const [error, setError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    // Auto-connect when component mounts
    handleConnect();
  }, []);

  const handleConnect = async () => {
    setIsConnecting(true);
    setError('');

    try {
      await connectToService();
    } catch (err) {
      setError('Failed to connect to the server. Please make sure the server is running and the API key is configured.');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="connection-setup">
      <div className="setup-container">
        <div className="setup-header">
          <h1>Claude Code Web Interface</h1>
          <p>Connecting to the server...</p>
        </div>
        
        <div className="connection-status">
          {isConnecting ? (
            <div className="loading-spinner">
              <div className="spinner"></div>
              <p>Connecting to server...</p>
            </div>
          ) : error ? (
            <div className="error-state">
              <div className="error-message">{error}</div>
              <button onClick={handleConnect} className="retry-button">
                Retry Connection
              </button>
            </div>
          ) : null}
        </div>
        
        <div className="setup-info">
          <h3>Server Requirements:</h3>
          <ol>
            <li>The server must be running on port 3001</li>
            <li>Environment variable ANTHROPIC_API_KEY must be set</li>
            <li>Get your API key from <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">console.anthropic.com</a></li>
          </ol>
          
          <div className="info-note">
            <strong>Server Configuration:</strong> The API key is configured server-side for security. 
            Check that the ANTHROPIC_API_KEY environment variable is properly set.
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectionSetup;