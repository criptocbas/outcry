"use client";

import { use, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import ProfileBadge from "@/components/social/ProfileBadge";
import FollowButton from "@/components/social/FollowButton";
import BadgeGrid from "@/components/badges/BadgeGrid";
import { useBadges } from "@/hooks/useBadges";
import { truncateAddress } from "@/lib/utils";
import {
  getProfile,
  getFollowers,
  getFollowing,
  findOrCreateProfile,
  updateUsername,
} from "@/lib/tapestry";
import type { ProfileWithCounts } from "@/lib/tapestry";

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: "easeOut" as const, delay },
  }),
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProfilePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = use(params);
  const { publicKey } = useWallet();
  const isOwnProfile = publicKey?.toBase58() === address;

  const [profile, setProfile] = useState<ProfileWithCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [followers, setFollowers] = useState<ProfileWithCounts[]>([]);
  const [following, setFollowing] = useState<ProfileWithCounts[]>([]);
  const [activeTab, setActiveTab] = useState<"followers" | "following">(
    "followers"
  );
  const [registering, setRegistering] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editInput, setEditInput] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { badges, loading: badgesLoading } = useBadges(address);

  // Fetch profile
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const p = await getProfile(address);
        if (!cancelled) setProfile(p);

        if (p?.profile.id) {
          const [frs, fng] = await Promise.all([
            getFollowers(p.profile.id, 20, 0),
            getFollowing(p.profile.id, 20, 0),
          ]);
          if (!cancelled) {
            setFollowers(frs.profiles);
            setFollowing(fng.profiles);
          }
        }
      } catch {
        // Silently ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [address]);

  // Register profile
  const handleRegister = async () => {
    if (!publicKey) return;
    const trimmed = usernameInput.trim();
    if (trimmed.length < 3) {
      setRegisterError("Username must be at least 3 characters.");
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      setRegisterError("Letters, numbers, and underscores only.");
      return;
    }
    setRegisterError(null);
    setRegistering(true);
    try {
      const p = await findOrCreateProfile(address, trimmed);
      setProfile(p);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create profile";
      setRegisterError(msg);
    } finally {
      setRegistering(false);
    }
  };

  // Edit username
  const handleEditUsername = async () => {
    if (!profile) return;
    const trimmed = editInput.trim();
    if (trimmed === profile.profile.username) {
      setEditing(false);
      return;
    }
    if (trimmed.length < 3) {
      setEditError("Username must be at least 3 characters.");
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      setEditError("Letters, numbers, and underscores only.");
      return;
    }
    setEditError(null);
    setSaving(true);
    try {
      const p = await updateUsername(profile.profile.id, trimmed);
      setProfile(p);
      setEditing(false);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to update username";
      setEditError(msg);
    } finally {
      setSaving(false);
    }
  };

  // Loading
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
          <p className="text-xs tracking-[0.2em] text-cream/40 uppercase">
            Loading profile...
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="mx-auto max-w-3xl px-6 pt-12 pb-24"
    >
      {/* Profile header */}
      <motion.div
        custom={0}
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        className="flex flex-col items-center gap-6 border-b border-charcoal-light pb-8"
      >
        <ProfileBadge walletAddress={address} size="lg" avatarOnly />

        {/* Username */}
        {profile && !editing && (
          <div className="group/name flex items-center gap-2">
            <h1 className="text-xl font-bold text-cream">
              {profile.profile.username}
            </h1>
            {isOwnProfile && (
              <button
                onClick={() => {
                  setEditInput(profile.profile.username);
                  setEditError(null);
                  setEditing(true);
                }}
                className="opacity-0 transition-opacity group-hover/name:opacity-100"
                aria-label="Edit username"
              >
                <svg className="h-4 w-4 text-cream/30 transition-colors hover:text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Edit username inline */}
        {editing && (
          <div className="flex w-full max-w-xs flex-col items-center gap-2">
            <input
              type="text"
              value={editInput}
              onChange={(e) => setEditInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleEditUsername();
                if (e.key === "Escape") setEditing(false);
              }}
              maxLength={30}
              autoFocus
              className="w-full rounded-md border border-charcoal-light bg-jet px-4 py-2 text-center text-sm text-cream placeholder-cream/20 focus-gold"
            />
            {editError && (
              <p className="text-xs text-red-400">{editError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleEditUsername}
                disabled={saving || !editInput.trim()}
                className="rounded-md bg-gold px-4 py-1.5 text-xs font-semibold tracking-[0.1em] text-jet uppercase transition-all hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="rounded-md border border-charcoal-light px-4 py-1.5 text-xs text-cream/50 transition-colors hover:text-cream disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Wallet address */}
        <p className="font-mono text-xs text-cream/40">
          {truncateAddress(address)}
        </p>

        {/* Stats */}
        {profile && (
          <div className="flex items-center gap-8">
            <Stat
              label="Followers"
              value={profile.socialCounts?.followers ?? 0}
            />
            <Stat
              label="Following"
              value={profile.socialCounts?.following ?? 0}
            />
            <Stat label="Posts" value={profile.socialCounts?.posts ?? 0} />
            <Stat label="Likes" value={profile.socialCounts?.likes ?? 0} />
          </div>
        )}

        {/* Follow button (for other users) or Register button */}
        {!isOwnProfile && profile && (
          <FollowButton targetWallet={address} />
        )}

        {!profile && isOwnProfile && (
          <div className="flex w-full max-w-xs flex-col items-center gap-3">
            <input
              type="text"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRegister()}
              placeholder="Choose a username"
              maxLength={30}
              className="w-full rounded-md border border-charcoal-light bg-jet px-4 py-2.5 text-center text-sm text-cream placeholder-cream/20 focus-gold"
            />
            {registerError && (
              <p className="text-xs text-red-400">{registerError}</p>
            )}
            <button
              onClick={handleRegister}
              disabled={registering || !usernameInput.trim()}
              className="flex h-10 w-full items-center justify-center rounded-md bg-gold text-sm font-semibold tracking-[0.1em] text-jet uppercase transition-all duration-200 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-40"
            >
              {registering ? "Creating..." : "Create Profile"}
            </button>
          </div>
        )}

        {!profile && !isOwnProfile && (
          <p className="text-xs text-cream/30">
            This user hasn&apos;t created a profile yet.
          </p>
        )}
      </motion.div>

      {/* Badges */}
      <motion.div
        custom={0.1}
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        className="mt-8"
      >
        <h2 className="mb-4 text-xs font-medium tracking-[0.2em] text-cream/40 uppercase">
          Auction Badges{!badgesLoading && badges.length > 0 && ` (${badges.length})`}
        </h2>
        <BadgeGrid badges={badges} loading={badgesLoading} />
      </motion.div>

      {/* Tabs */}
      {profile && (
        <motion.div
          custom={0.2}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="mt-8"
        >
          {/* Tab header */}
          <div className="flex border-b border-charcoal-light">
            <TabButton
              active={activeTab === "followers"}
              onClick={() => setActiveTab("followers")}
              count={profile.socialCounts.followers}
            >
              Followers
            </TabButton>
            <TabButton
              active={activeTab === "following"}
              onClick={() => setActiveTab("following")}
              count={profile.socialCounts.following}
            >
              Following
            </TabButton>
          </div>

          {/* Tab content */}
          <div className="mt-4 flex flex-col gap-2">
            {activeTab === "followers" && followers.length === 0 && (
              <p className="py-8 text-center text-xs text-cream/20">
                No followers yet
              </p>
            )}
            {activeTab === "following" && following.length === 0 && (
              <p className="py-8 text-center text-xs text-cream/20">
                Not following anyone yet
              </p>
            )}

            {(activeTab === "followers" ? followers : following).map(
              (person) => (
                <a
                  key={person.profile.id}
                  href={`/profile/${person.profile.walletAddress}`}
                  className="flex items-center justify-between rounded-lg border border-charcoal-light/50 bg-charcoal px-4 py-3 transition-colors duration-200 hover:border-gold/20"
                >
                  <ProfileBadge
                    walletAddress={person.profile.walletAddress}
                    size="sm"
                  />
                  <FollowButton
                    targetWallet={person.profile.walletAddress}
                  />
                </a>
              )
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-lg font-bold tabular-nums text-cream/80">
        {value}
      </span>
      <span className="text-[10px] tracking-[0.15em] text-cream/30 uppercase">
        {label}
      </span>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-medium tracking-[0.1em] uppercase transition-all duration-200 ${
        active
          ? "border-gold text-gold"
          : "border-transparent text-cream/30 hover:text-cream/50"
      }`}
    >
      {children}
      <span
        className={`tabular-nums ${
          active ? "text-gold/70" : "text-cream/20"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
