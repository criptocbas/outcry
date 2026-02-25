"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  checkFollowStatus,
  followUser,
  unfollowUser,
} from "@/lib/tapestry";
import { useTapestryProfile } from "./useTapestryProfile";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseFollowStatusReturn {
  isFollowing: boolean;
  loading: boolean;
  toggle: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFollowStatus(
  myWallet: string | null,
  targetWallet: string | null
): UseFollowStatusReturn {
  // Resolve wallet addresses → Tapestry profile IDs.
  // The follow API expects profile IDs (usernames), not wallet addresses.
  const { profile: myProfile } = useTapestryProfile(myWallet);
  const { profile: targetProfile } = useTapestryProfile(targetWallet);

  const myId = myProfile?.profile?.id ?? null;
  const targetId = targetProfile?.profile?.id ?? null;

  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(false);

  // Guard against stale responses when wallets change.
  const activeKeyRef = useRef<string | null>(null);

  // Check follow status on mount / profile ID change.
  useEffect(() => {
    if (!myId || !targetId || myId === targetId) {
      setIsFollowing(false);
      setLoading(false);
      activeKeyRef.current = null;
      return;
    }

    const key = `${myId}:${targetId}`;
    activeKeyRef.current = key;

    let cancelled = false;

    async function check() {
      setLoading(true);
      try {
        const status = await checkFollowStatus(myId!, targetId!);
        if (!cancelled && activeKeyRef.current === key) {
          setIsFollowing(status.isFollowing);
        }
      } catch {
        // Silently ignore -- default to not following.
        if (!cancelled) setIsFollowing(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    check();

    return () => {
      cancelled = true;
    };
  }, [myId, targetId]);

  // Rapid-click guard
  const togglingRef = useRef(false);

  // Toggle follow / unfollow.
  const toggle = useCallback(async () => {
    if (!myId || !targetId || myId === targetId || togglingRef.current) return;

    togglingRef.current = true;
    setLoading(true);
    try {
      if (isFollowing) {
        await unfollowUser(myId, targetId);
        setIsFollowing(false);
      } else {
        await followUser(myId, targetId);
        setIsFollowing(true);
      }
    } catch {
      // Revert on error is implicit -- we only set state on success.
    } finally {
      setLoading(false);
      togglingRef.current = false;
    }
  }, [myId, targetId, isFollowing]);

  return { isFollowing, loading, toggle };
}
