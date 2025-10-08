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
              return !inline ? (
                <pre className="code-block">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              ) : (
                <code className="inline-code" {...props}>
                  {children}
                </code>
              );
            },
            pre: ({ children }: any) => (
              <div className="code-container">{children}</div>
            ),
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
