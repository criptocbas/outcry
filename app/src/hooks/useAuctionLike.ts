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

  // Guard stale responses.
  const activeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!auctionId) return;

    const key = `${auctionId}:${userProfileId ?? "anon"}`;
    activeKeyRef.current = key;

    let cancelled = false;

    async function fetchLikeData() {
      setLoading(true);
      try {
        // Fetch count for all users.
        const count = await getLikeCount(auctionId);
        if (!cancelled && activeKeyRef.current === key) {
          setLikeCount(count);
        }

        // Check individual like status only if logged in.
        if (userProfileId) {
          const status = await checkLikeStatus(userProfileId, auctionId);
          if (!cancelled && activeKeyRef.current === key) {
            setHasLiked(status.hasLiked);
          }
        } else {
          if (!cancelled) setHasLiked(false);
        }
      } catch {
        // Silently ignore -- defaults are fine (0 likes, not liked).
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchLikeData();

    // Poll like count every 15s so others' likes show up
    const interval = setInterval(() => {
      if (activeKeyRef.current === key) {
        getLikeCount(auctionId)
          .then((count) => {
            if (activeKeyRef.current === key) setLikeCount(count);
          })
          .catch(() => {});
      }
    }, 15_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
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
      // Silently ignore -- state stays as is on failure.
    } finally {
      setLoading(false);
    }
  }, [userProfileId, auctionId, hasLiked]);

  return { hasLiked, likeCount, loading, toggle };
}
