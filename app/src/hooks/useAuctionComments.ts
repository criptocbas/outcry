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

  // Track active fetch so stale responses from a different auctionId
  // don't overwrite state.
  const activeIdRef = useRef<string | null>(null);

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
      // Tapestry may not have a content entry for this auction yet.
      // Treat as empty rather than showing an error.
      if (activeIdRef.current === auctionId) {
        setComments([]);
      }
    } finally {
      if (activeIdRef.current === auctionId) {
        setLoading(false);
      }
    }
  }, [auctionId]);

  // Fetch on mount / auctionId change, then poll every 10s for new comments.
  useEffect(() => {
    fetchComments();

    const interval = setInterval(() => {
      if (activeIdRef.current === auctionId) {
        getComments(auctionId, 50, 0)
          .then((result) => {
            if (activeIdRef.current === auctionId) {
              setComments(result.comments);
            }
          })
          .catch(() => {});
      }
    }, 10_000);

    return () => {
      activeIdRef.current = null;
      clearInterval(interval);
    };
  }, [fetchComments, auctionId]);

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
        // Prepend to give immediate feedback (newest first).
        setComments((prev) => [newComment, ...prev]);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to post comment";
        setError(message);
        throw err; // Re-throw so the UI can handle it.
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
