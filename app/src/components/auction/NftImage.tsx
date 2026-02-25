"use client";

import { useState, useEffect } from "react";
import { useNftMetadata } from "@/hooks/useNftMetadata";

interface NftImageProps {
  mintAddress: string;
  /** Optional CSS class for the outer container */
  className?: string;
  /** Show the NFT name overlaid at the bottom */
  showName?: boolean;
}

function seedHue(address: string): number {
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = address.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

/**
 * Displays the actual NFT artwork by resolving Metaplex metadata.
 * Falls back to a styled gradient placeholder if no image is available.
 */
export default function NftImage({
  mintAddress,
  className = "",
  showName = false,
}: NftImageProps) {
  const { metadata, loading } = useNftMetadata(mintAddress);
  const [imgError, setImgError] = useState(false);
  const hue = seedHue(mintAddress);

  // Reset error state when mint changes so the new image gets a chance to load
  useEffect(() => { setImgError(false); }, [mintAddress]);

  const hasImage = metadata?.image && !imgError;

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={
        hasImage
          ? undefined
          : {
              background: `linear-gradient(135deg, hsl(${hue}, 15%, 8%) 0%, hsl(${(hue + 40) % 360}, 20%, 12%) 50%, hsl(${(hue + 80) % 360}, 10%, 6%) 100%)`,
            }
      }
    >
      {/* Loading shimmer */}
      {loading && !metadata && (
        <div className="absolute inset-0 animate-shimmer" />
      )}

      {/* Actual NFT image with blur-up transition */}
      {hasImage && (
        <img
          src={metadata!.image!}
          alt={metadata?.name || "NFT"}
          onLoad={(e) => e.currentTarget.classList.remove("blur-sm", "scale-105")}
          onError={() => setImgError(true)}
          className="absolute inset-0 h-full w-full object-cover blur-sm scale-105 transition-all duration-500"
          loading="lazy"
        />
      )}

      {/* Fallback: gradient with grid overlay */}
      {!hasImage && !loading && (
        <>
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(198,169,97,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(198,169,97,0.5) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-serif text-lg italic text-cream/10">
              {metadata?.name || "NFT"}
            </span>
          </div>
        </>
      )}

      {/* Name overlay */}
      {showName && metadata?.name && (
        <div className="absolute right-0 bottom-0 left-0 bg-gradient-to-t from-black/70 to-transparent px-4 pt-8 pb-3">
          <p className="truncate font-serif text-sm font-medium text-cream/90">
            {metadata.name}
          </p>
        </div>
      )}
    </div>
  );
}
