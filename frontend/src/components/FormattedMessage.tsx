import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './FormattedMessage.css';

interface FormattedMessageProps {
  content: string;
  isUser?: boolean;
}

const FormattedMessage: React.FC<FormattedMessageProps> = ({
  content,
  isUser = false
}) => {
  const downloadCode = (code: string, language: string = 'txt') => {
    const fileExtension = getFileExtension(language);
    const filename = `code.${fileExtension}`;
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getFileExtension = (language: string): string => {
    const extensions: { [key: string]: string } = {
      javascript: 'js',
      typescript: 'ts',
      jsx: 'jsx',
      tsx: 'tsx',
      python: 'py',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      csharp: 'cs',
      php: 'php',
      ruby: 'rb',
      go: 'go',
      rust: 'rs',
      swift: 'swift',
      kotlin: 'kt',
      scala: 'scala',
      html: 'html',
      css: 'css',
      scss: 'scss',
      sass: 'sass',
      less: 'less',
      json: 'json',
      xml: 'xml',
      yaml: 'yml',
      yml: 'yml',
      toml: 'toml',
      sql: 'sql',
      sh: 'sh',
      bash: 'sh',
      zsh: 'zsh',
      powershell: 'ps1',
      dockerfile: 'dockerfile',
      makefile: 'makefile',
      r: 'r',
      matlab: 'm',
      perl: 'pl',
      lua: 'lua',
      dart: 'dart'
    };
    return extensions[language.toLowerCase()] || 'txt';
  };
  if (isUser) {
    return (
      <div className="message user-message">
        <div className="message-content">{content}</div>
      </div>
    );
  }

  return (
    <div className="message claude-message">
      <div className="message-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code: ({ node, className, children, ...props }: any) => {
              const match = /language-(\w+)/.exec(className || '');
              const inline = !match;
              const language = match ? match[1] : '';
              const codeText = String(children).replace(/\n$/, '');
              
              return !inline ? (
                <div className="code-container">
                  <div className="code-header">
                    <span className="code-language">{language}</span>
                    <button 
                      className="download-button"
                      onClick={() => downloadCode(codeText, language)}
                      title="Download code"
                    >
                      📥 Download
                    </button>
                  </div>
                  <pre className="code-block">
                    <code className={className} {...props}>
                      {children}
                    </code>
                  </pre>
                </div>
              ) : (
                <code className="inline-code" {...props}>
                  {children}
                </code>
              );
            },
            pre: ({ children }: any) => children,
            blockquote: ({ children }: any) => (
              <blockquote className="blockquote">{children}</blockquote>
            ),
            table: ({ children }: any) => (
              <div className="table-container">
                <table className="formatted-table">{children}</table>
              </div>
            ),
            ul: ({ children }: any) => (
              <ul className="formatted-list">{children}</ul>
            ),
            ol: ({ children }: any) => (
              <ol className="formatted-list">{children}</ol>
            )
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
};

export default FormattedMessage;
