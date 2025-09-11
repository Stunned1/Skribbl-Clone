import React, { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../types/game';

interface ChatProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  onSendWinnersMessage?: (message: string) => void;
  isWinner: boolean;
  isArtist: boolean;
  disabled?: boolean;
}

export const Chat: React.FC<ChatProps> = ({
  messages,
  onSendMessage,
  onSendWinnersMessage,
  isWinner,
  isArtist,
  disabled = false,
}) => {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || disabled) return;

    const text = inputValue.trim();

    // If user is a winner or artist, route to winners-only handler when provided
    if ((isWinner || isArtist) && onSendWinnersMessage) {
      onSendWinnersMessage(text);
    } else {
      onSendMessage(text);
    }
    
    setInputValue('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleSubmit(e as any);
    }
  };

  const canViewWinners = isWinner || isArtist;
  const visibleMessages = messages.filter(m => !m.is_winners_only || canViewWinners);

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow-md">
      {/* Chat Header */}
      <div className="flex items-center justify-between p-3 border-b bg-gray-50 rounded-t-lg">
        <h3 className="font-semibold text-gray-800">Game Chat</h3>
      </div>

      {/* Messages Display */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
        {visibleMessages.length === 0 ? (
          <div className="text-center text-gray-500 py-8">No messages yet</div>
        ) : (
          visibleMessages.map((message) => (
            <ChatMessageItem
              key={message.id}
              message={message}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="p-3 border-t bg-gray-50 rounded-b-lg">
        <div className="flex space-x-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={(isWinner || isArtist) ? 'You are a winner — chat with other winners' : 'Type to chat or guess the word...'}
            disabled={disabled}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || disabled}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
};

interface ChatMessageItemProps {
  message: ChatMessage;
}

const ChatMessageItem: React.FC<ChatMessageItemProps> = ({ message }) => {
  const isWinnersOnly = message.is_winners_only;

  const messageClass = isWinnersOnly
    ? 'bg-green-50 border-green-200 text-green-800'
    : 'bg-gray-50 border-gray-200 text-gray-800';

  const usernameClass = isWinnersOnly
    ? 'text-green-700 font-semibold'
    : 'text-blue-600 font-semibold';

  return (
    <div className={`p-2 rounded-lg border ${messageClass}`}>
      <div className="flex items-start space-x-2">
        <div className="flex-1 min-w-0">
          <div className={`text-sm ${usernameClass}`}>
            {message.username}
            {isWinnersOnly && (
              <span className="ml-2 text-xs bg-green-200 text-green-700 px-2 py-1 rounded-full">
                Winners Only
              </span>
            )}
          </div>
          <div className={`text-sm mt-1 break-words ${isWinnersOnly ? 'text-green-800' : ''}`}>{message.message}</div>
          <div className="text-xs text-gray-500 mt-1">
            {new Date(message.timestamp).toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  );
};
