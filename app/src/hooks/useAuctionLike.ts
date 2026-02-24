"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  checkLikeStatus,
  likeContent,
  unlikeContent,
  getLikeCount,
} from "@/lib/tapestry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseAuctionLikeReturn {
  hasLiked: boolean;
  likeCount: number;
  loading: boolean;
  toggle: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuctionLike(
  auctionId: string,
  userProfileId: string | null
): UseAuctionLikeReturn {
  const [hasLiked, setHasLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const activeKeyRef = useRef<string | null>(null);
  const pollingRef = useRef(false);

  // Initial fetch
  useEffect(() => {
    if (!auctionId) return;

    const key = `${auctionId}:${userProfileId ?? "anon"}`;
    activeKeyRef.current = key;

    let cancelled = false;

    async function fetchLikeData() {
      setLoading(true);
      try {
        const count = await getLikeCount(auctionId);
        if (!cancelled && activeKeyRef.current === key) {
          setLikeCount(count);
        }

        if (userProfileId) {
          const status = await checkLikeStatus(userProfileId, auctionId);
          if (!cancelled && activeKeyRef.current === key) {
            setHasLiked(status.hasLiked);
          }
        } else {
          if (!cancelled) setHasLiked(false);
        }
      } catch {
        // Silently ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchLikeData();

    // Poll like count every 15s with overlap guard
    const interval = setInterval(() => {
      if (pollingRef.current || activeKeyRef.current !== key) return;
      pollingRef.current = true;

      getLikeCount(auctionId)
        .then((count) => {
          if (activeKeyRef.current === key) setLikeCount(count);
        })
        .catch(() => {})
        .finally(() => {
          pollingRef.current = false;
        });
    }, 15_000);

    return () => {
      cancelled = true;
      activeKeyRef.current = null;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auctionId, userProfileId]);

  const toggle = useCallback(async () => {
    if (!userProfileId || !auctionId) return;

    setLoading(true);
    try {
      if (hasLiked) {
        await unlikeContent(userProfileId, auctionId);
        setHasLiked(false);
        setLikeCount((prev) => Math.max(0, prev - 1));
      } else {
        await likeContent(userProfileId, auctionId);
        setHasLiked(true);
        setLikeCount((prev) => prev + 1);
      }
    } catch {
      // Silently ignore
    } finally {
      setLoading(false);
    }
  }, [userProfileId, auctionId, hasLiked]);

  return { hasLiked, likeCount, loading, toggle };
}
