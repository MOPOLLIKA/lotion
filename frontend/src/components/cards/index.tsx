import React from "react";
import { motion } from "framer-motion";
import { Heart } from "lucide-react";

// Base Card Interface
export interface BaseCard {
  id: string;
  type: string;
  title?: string;
  timestamp: Date;
}

// Base Card Component
interface BaseCardProps {
  card: BaseCard;
  children: React.ReactNode;
  className?: string;
}

export const BaseCard: React.FC<BaseCardProps> = ({ card, children, className = "" }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl p-4 shadow-lg ${className}`}
    >
      {card.title && (
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
          <h3 className="text-sm font-semibold text-white">{card.title}</h3>
        </div>
      )}
      {children}
      <div className="text-xs text-white/60 mt-3 pt-2 border-t border-white/10">
        {card.timestamp.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>
    </motion.div>
  );
};

// Product Examples Card Types
export interface ProductExample {
  id: string;
  name: string;
  description?: string;
  imageUrl: string;
  price?: string;
  category?: string;
  rating?: number;
  url?: string;
  isLiked?: boolean;
}

export interface ProductExamplesCard extends BaseCard {
  type: "product_examples";
  products: ProductExample[];
  title?: string;
}

// Product Examples Card Component
interface ProductExamplesCardProps {
  card: ProductExamplesCard;
}

export const ProductExamplesCard: React.FC<ProductExamplesCardProps> = ({ card }) => {
  const [likedProducts, setLikedProducts] = React.useState<Set<string>>(new Set());

  const handleProductClick = (product: ProductExample) => {
    if (product.url) {
      window.open(product.url, '_blank');
    }
  };

  const handleLikeToggle = (productId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent triggering product click
    setLikedProducts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(productId)) {
        newSet.delete(productId);
      } else {
        newSet.add(productId);
      }
      return newSet;
    });
  };

  return (
    <BaseCard card={card} className="max-w-4xl">
      <div className="space-y-4">
        <div className="text-center mb-4">
          <h2 className="text-lg font-semibold text-white mb-1">
            {card.title || "Product Examples"}
          </h2>
          <p className="text-sm text-white/70">
            {card.products.length} product{card.products.length !== 1 ? 's' : ''} found
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {card.products.map((product, index) => (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-3 hover:bg-white/10 transition-all duration-300 ${
                product.url ? 'cursor-pointer hover:scale-105' : ''
              }`}
              onClick={() => handleProductClick(product)}
            >
              {/* Product Image */}
              <div className="relative mb-3">
                <div className="aspect-square rounded-lg overflow-hidden bg-white/5">
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover hover:scale-110 transition-transform duration-300"
                    onError={(e) => {
                      // Fallback to a placeholder if image fails to load
                      e.currentTarget.src = `https://via.placeholder.com/300x300/1F2023/FFFFFF?text=${encodeURIComponent(product.name)}`;
                    }}
                  />
                </div>
                
                {/* Heart Button */}
                <motion.button
                  onClick={(e) => handleLikeToggle(product.id, e)}
                  className="absolute top-2 left-2 bg-black/70 backdrop-blur-sm rounded-full p-2 hover:bg-black/80 transition-colors"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Heart 
                    className={`w-4 h-4 transition-colors ${
                      likedProducts.has(product.id) 
                        ? 'text-red-500 fill-red-500' 
                        : 'text-white hover:text-red-400'
                    }`}
                  />
                </motion.button>
                
                {/* Rating Badge */}
                {product.rating && (
                  <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm rounded-full px-2 py-1">
                    <div className="flex items-center gap-1">
                      <span className="text-yellow-400 text-xs">★</span>
                      <span className="text-white text-xs font-medium">{product.rating}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Product Info */}
              <div className="space-y-2">
                <h3 className="font-semibold text-white text-sm line-clamp-2">
                  {product.name}
                </h3>
                
                {product.description && (
                  <p className="text-white/70 text-xs line-clamp-2">
                    {product.description}
                  </p>
                )}

                <div className="flex items-center justify-between">
                  {product.price && (
                    <span className="text-green-400 font-semibold text-sm">
                      {product.price}
                    </span>
                  )}
                  
                  {product.category && (
                    <span className="text-white/50 text-xs bg-white/10 px-2 py-1 rounded-full">
                      {product.category}
                    </span>
                  )}
                </div>

                {product.url && (
                  <div className="pt-2">
                    <div className="text-blue-400 text-xs font-medium hover:text-blue-300 transition-colors">
                      View Product →
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Summary */}
        <div className="mt-4 pt-3 border-t border-white/10">
          <p className="text-center text-white/60 text-sm">
            Showing {card.products.length} product{card.products.length !== 1 ? 's' : ''} 
            {card.products.length > 0 && ` • Click any product to view details`}
          </p>
        </div>
      </div>
    </BaseCard>
  );
};

// Card Renderer Component
interface CardRendererProps {
  card: BaseCard;
}

export const CardRenderer: React.FC<CardRendererProps> = ({ card }) => {
  switch (card.type) {
    case "product_examples":
      return <ProductExamplesCard card={card as ProductExamplesCard} />;
    default:
      return (
        <BaseCard card={card}>
          <div className="text-center text-white/70">
            <p>Unknown card type: {card.type}</p>
          </div>
        </BaseCard>
      );
  }
};
