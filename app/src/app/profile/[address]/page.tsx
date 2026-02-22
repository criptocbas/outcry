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
        <ProfileBadge walletAddress={address} size="lg" />

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
              className="w-full rounded-md border border-charcoal-light bg-jet px-4 py-2.5 text-center text-sm text-cream placeholder-cream/20 outline-none transition-colors focus:border-gold/60"
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
          Auction Badges
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
