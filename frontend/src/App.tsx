import React from 'react';
import { ClaudeProvider, useClaudeContext } from './contexts/ClaudeContext';
import ChatInterface from './components/ChatInterface';
import ConnectionSetup from './components/ConnectionSetup';
import './App.css';

function AppContent() {
  const { isConnected } = useClaudeContext();
  
  return (
    <div className="App">
      {isConnected ? <ChatInterface /> : <ConnectionSetup />}
    </div>
  );
}

function App() {
  return (
    <ClaudeProvider>
      <AppContent />
    </ClaudeProvider>
  );
}

export default App;
