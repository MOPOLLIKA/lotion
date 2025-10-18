"use client";

import React, { useState, useRef, useEffect } from "react";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import { Bot, User, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { CardRenderer, BaseCard } from "@/components/cards";

interface Message {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date;
  files?: File[];
  cards?: BaseCard[];
}

interface ChatInterfaceProps {
  onBackToPrompt: () => void;
  onSendMessage: (message: string, files?: File[]) => void;
  isLoading: boolean;
}

export const ChatInterface = React.forwardRef<
  { addAssistantMessage: (content: string, cards?: BaseCard[]) => void },
  ChatInterfaceProps
>(({ onBackToPrompt, onSendMessage, isLoading }, ref) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = (message: string, files?: File[]) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      content: message,
      role: "user",
      timestamp: new Date(),
      files,
    };

    setMessages(prev => [...prev, userMessage]);
    onSendMessage(message, files);
  };

  const addAssistantMessage = (content: string, cards?: BaseCard[]) => {
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      content,
      role: "assistant",
      timestamp: new Date(),
      cards,
    };
    
    setMessages(prev => [...prev, assistantMessage]);
  };

  // Expose this function to parent component
  React.useImperativeHandle(ref, () => ({
    addAssistantMessage,
  }));

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto bg-transparent">
      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 p-4 mb-4"
      >
        <button
          onClick={onBackToPrompt}
          className="flex items-center gap-2 text-white/80 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Back to prompt</span>
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-white">AI Assistant</h2>
            <p className="text-xs text-white/60">Always here to help</p>
          </div>
          <div className="ml-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          </div>
        </div>
      </motion.div>

      {/* Messages Area */}
      <div 
        ref={scrollAreaRef}
        className="flex-1 overflow-y-auto px-4 mb-4 space-y-4"
        style={{ maxHeight: 'calc(100vh - 200px)' }}
      >
        <AnimatePresence>
          {messages.map((message, index) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, delay: index * 0.1 }}
              className={`flex gap-3 ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {message.role === "assistant" && (
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}
              
              <div className="max-w-[70%]">
                <div
                  className={`rounded-2xl px-4 py-3 ${
                    message.role === "user"
                      ? "bg-white/90 text-gray-900"
                      : "bg-white/10 backdrop-blur-sm text-white border border-white/20"
                  }`}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {message.content}
                  </p>
                  
                  {/* File previews */}
                  {message.files && message.files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {message.files.map((file, fileIndex) => (
                        <div key={fileIndex} className="w-16 h-16 rounded-xl overflow-hidden bg-white/20">
                          <img
                            src={URL.createObjectURL(file)}
                            alt={file.name}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Cards */}
                  {message.cards && message.cards.length > 0 && (
                    <div className="mt-3 space-y-3">
                      {message.cards.map((card) => (
                        <CardRenderer key={card.id} card={card} />
                      ))}
                    </div>
                  )}
                  
                  <p className={`text-xs mt-2 ${
                    message.role === "user" ? "text-gray-500" : "text-white/60"
                  }`}>
                    {message.timestamp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>

              {message.role === "user" && (
                <div className="w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-white" />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        
        {isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3 justify-start"
          >
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl px-4 py-3 border border-white/20">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Input Area */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="px-4 pb-4"
      >
        <PromptInputBox
          onSend={handleSendMessage}
          isLoading={isLoading}
          placeholder="Continue the conversation..."
        />
      </motion.div>
    </div>
  );
});

ChatInterface.displayName = "ChatInterface";
