"use client";

import React, { useState, useRef } from "react";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import { ChatInterface } from "@/components/chat-interface";
import { motion, AnimatePresence } from "framer-motion";
import { BaseCard, ProductExamplesCard } from "@/components/cards";

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [, setFirstMessage] = useState("");
  const chatInterfaceRef = useRef<{ addAssistantMessage: (content: string, cards?: BaseCard[]) => void }>(null);

  const handleSendMessage = async (message: string, files?: File[]) => {
    console.log('Message:', message);
    console.log('Files:', files);
    
    setIsLoading(true);
    
    // If this is the first message, transition to chat interface
    if (!showChat) {
      setFirstMessage(message);
      setShowChat(true);
    }
    
    // Simulate AI response
    setTimeout(() => {
      const response = `I received your message: "${message}". This is a simulated AI response. In a real implementation, you would connect this to your AI backend service.`;
      
      // Create sample product examples card if message contains "product" or "show me"
      let cards: BaseCard[] = [];
      if (message.toLowerCase().includes('product') || message.toLowerCase().includes('show me')) {
        const productCard: ProductExamplesCard = {
          id: `product-card-${Date.now()}`,
          type: "product_examples",
          title: "Product Examples",
          timestamp: new Date(),
          products: [
            {
              id: "1",
              name: "Wireless Bluetooth Headphones",
              description: "Premium noise-canceling headphones with 30-hour battery life",
              imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=300&h=300&fit=crop",
              price: "$199.99",
              category: "Electronics",
              rating: 4.8,
              url: "https://example.com/product/1"
            },
            {
              id: "2", 
              name: "Smart Fitness Watch",
              description: "Track your health and fitness with advanced sensors",
              imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300&h=300&fit=crop",
              price: "$299.99",
              category: "Wearables",
              rating: 4.6,
              url: "https://example.com/product/2"
            }
          ]
        };
        cards = [productCard];
      }
      
      if (chatInterfaceRef.current) {
        chatInterfaceRef.current.addAssistantMessage(response, cards);
      }
      
      setIsLoading(false);
    }, 2000);
  };

  const handleBackToPrompt = () => {
    setShowChat(false);
    setFirstMessage("");
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(125%_125%_at_50%_101%,rgba(245,87,2,1)_10.5%,rgba(245,120,2,1)_16%,rgba(245,140,2,1)_17.5%,rgba(245,170,100,1)_25%,rgba(238,174,202,1)_40%,rgba(202,179,214,1)_65%,rgba(148,201,233,1)_100%)] flex items-center justify-center p-4">
      <div className="w-full max-w-[500px]">
        <AnimatePresence mode="wait">
          {!showChat ? (
            <motion.div
              key="prompt"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-center"
              >
                <h1 className="text-4xl font-bold text-white mb-4">
                  AI Chat Assistant
                </h1>
                <p className="text-lg text-white/80 max-w-2xl mx-auto">
                  Experience the future of conversation with our intelligent AI assistant. 
                  Ask questions, get help, or simply chat away!
                </p>
              </motion.div>
              
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <PromptInputBox
                  onSend={handleSendMessage}
                  isLoading={isLoading}
                  placeholder="Type your message here..."
                />
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="chat"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="w-full"
            >
              <ChatInterface
                ref={chatInterfaceRef}
                onBackToPrompt={handleBackToPrompt}
                onSendMessage={handleSendMessage}
                isLoading={isLoading}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}