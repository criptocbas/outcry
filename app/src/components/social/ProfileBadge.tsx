"use client";

import { useTapestryProfile } from "@/hooks/useTapestryProfile";
import { truncateAddress } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfileBadgeProps {
  walletAddress: string;
  size?: "sm" | "md" | "lg";
  avatarOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic hue from a string -- used for the avatar circle color.
 */
function hashToHue(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

/**
 * First character for the avatar circle.
 */
function avatarLetter(username: string | undefined, wallet: string): string {
  if (username && username.length > 0) {
    return username.charAt(0).toUpperCase();
  }
  return wallet.charAt(0).toUpperCase();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProfileBadge({
  walletAddress,
  size = "sm",
  avatarOnly = false,
}: ProfileBadgeProps) {
  const { profile, loading } = useTapestryProfile(walletAddress);

  const isSm = size === "sm";
  const isLg = size === "lg";
  const avatarSize = isLg
    ? "h-16 w-16 text-2xl"
    : isSm
      ? "h-6 w-6 text-[10px]"
      : "h-8 w-8 text-xs";
  const nameSize = isLg ? "text-xl" : isSm ? "text-xs" : "text-sm";
  const countSize = isLg ? "text-sm" : isSm ? "text-[10px]" : "text-xs";

  // Skeleton shimmer while loading.
  if (loading) {
    return (
      <div className={`flex items-center ${isLg ? "flex-col gap-3" : "gap-2"}`}>
        <div
          className={`${avatarSize} animate-shimmer rounded-full`}
        />
        <div className={`flex flex-col gap-1 ${isLg ? "items-center" : ""}`}>
          <div
            className={`animate-shimmer rounded ${
              isLg ? "h-5 w-28" : isSm ? "h-3 w-16" : "h-3.5 w-20"
            }`}
          />
          <div
            className={`animate-shimmer rounded ${
              isLg ? "h-3 w-16" : isSm ? "h-2 w-10" : "h-2.5 w-14"
            }`}
          />
        </div>
      </div>
    );
  }

  const hue = hashToHue(walletAddress);
  const username = profile?.profile.username;
  const displayName = username || truncateAddress(walletAddress);
  const letter = avatarLetter(username, walletAddress);
  const followers = profile?.socialCounts.followers ?? 0;

  return (
    <div className={`flex items-center ${isLg ? "flex-col gap-3" : "gap-2"}`}>
      {/* Avatar circle */}
      <div
        className={`${avatarSize} flex flex-shrink-0 items-center justify-center rounded-full font-semibold text-jet`}
        style={{
          backgroundColor: `hsl(${hue}, 45%, 65%)`,
          fontFamily: "var(--font-sans)",
        }}
      >
        {letter}
      </div>

      {/* Name + follower count */}
      {!avatarOnly && (
        <div className={`flex flex-col leading-tight ${isLg ? "items-center" : ""}`}>
          <span
            className={`${nameSize} font-medium text-cream/90 truncate ${isLg ? "max-w-[240px]" : "max-w-[120px]"}`}
            style={{ fontFamily: isLg ? "var(--font-serif)" : "var(--font-sans)" }}
          >
            {displayName}
          </span>
          <span
            className={`${countSize} text-muted`}
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {followers} {followers === 1 ? "follower" : "followers"}
          </span>
        </div>
      )}
    </div>
  );
}
