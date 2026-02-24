"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getComments,
  postComment as apiPostComment,
} from "@/lib/tapestry";
import type { Comment } from "@/lib/tapestry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseAuctionCommentsReturn {
  comments: Comment[];
  loading: boolean;
  error: string | null;
  postComment: (text: string) => Promise<void>;
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuctionComments(
  auctionId: string,
  userProfileId: string | null
): UseAuctionCommentsReturn {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeIdRef = useRef<string | null>(null);
  const pollingRef = useRef(false);

  const fetchComments = useCallback(async () => {
    if (!auctionId) {
      setComments([]);
      return;
    }

    activeIdRef.current = auctionId;
    setLoading(true);
    setError(null);

    try {
      const result = await getComments(auctionId, 50, 0);
      if (activeIdRef.current === auctionId) {
        setComments(result.comments);
      }
    } catch {
      if (activeIdRef.current === auctionId) {
        setComments([]);
      }
    } finally {
      if (activeIdRef.current === auctionId) {
        setLoading(false);
      }
    }
  }, [auctionId]);

  // Initial fetch + poll every 15s
  useEffect(() => {
    if (!auctionId) return;

    activeIdRef.current = auctionId;
    fetchComments();

    const interval = setInterval(() => {
      // Skip if a poll is already in flight
      if (pollingRef.current || activeIdRef.current !== auctionId) return;
      pollingRef.current = true;

      getComments(auctionId, 50, 0)
        .then((result) => {
          if (activeIdRef.current === auctionId) {
            setComments(result.comments);
          }
        })
        .catch(() => {})
        .finally(() => {
          pollingRef.current = false;
        });
    }, 15_000);

    return () => {
      activeIdRef.current = null;
      clearInterval(interval);
    };
    // Only re-run when auctionId actually changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auctionId]);

  // Post a new comment and optimistically prepend it.
  const postComment = useCallback(
    async (text: string) => {
      if (!userProfileId || !auctionId || !text.trim()) return;

      try {
        const newComment = await apiPostComment(
          userProfileId,
          auctionId,
          text.trim()
        );
        setComments((prev) => [newComment, ...prev]);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to post comment";
        setError(message);
        throw err;
      }
    },
    [userProfileId, auctionId]
  );

  return {
    comments,
    loading,
    error,
    postComment,
    refresh: fetchComments,
  };
}
