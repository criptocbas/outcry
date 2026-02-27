"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuctionComments } from "@/hooks/useAuctionComments";
import { useTapestryProfile } from "@/hooks/useTapestryProfile";
import Spinner from "@/components/ui/Spinner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommentSectionProps {
  auctionId: string;
  headerRight?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Math.floor((now - then) / 1000));

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CommentSection({ auctionId, headerRight }: CommentSectionProps) {
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58() ?? null;
  const { profile: myProfile } = useTapestryProfile(walletAddress);
  const userProfileId = myProfile?.profile?.id ?? null;

  const { comments, loading, error, postComment } = useAuctionComments(
    auctionId,
    userProfileId
  );

  const [inputText, setInputText] = useState("");
  const [posting, setPosting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastPostedRef = useRef<string>("");

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = inputText.trim();
      if (!text || !userProfileId || posting) return;

      // Prevent accidental double-posts of the same message
      if (text === lastPostedRef.current) return;

      setPosting(true);
      try {
        await postComment(text);
        lastPostedRef.current = text;
        setInputText("");
        inputRef.current?.focus();
      } catch {
        // Error is already set in the hook.
      } finally {
        setPosting(false);
      }
    },
    [inputText, userProfileId, posting, postComment]
  );

  return (
    <div className="flex flex-col rounded-lg border border-charcoal-light bg-charcoal">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-charcoal-light px-5 py-3">
        <div className="flex items-center gap-3">
          <h3
            className="text-[10px] tracking-[0.2em] text-cream/40 uppercase"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Comments
          </h3>
          <span
            className="text-[10px] tabular-nums text-muted"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {comments.length}
          </span>
        </div>
        {headerRight && <div className="flex items-center">{headerRight}</div>}
      </div>

      {/* Comment list */}
      <div className="flex max-h-80 flex-col gap-0 overflow-y-auto">
        {loading && comments.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
          </div>
        )}

        {!loading && comments.length === 0 && !error && (
          <p
            className="px-5 py-8 text-center text-xs text-cream/20"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            No comments yet. Be the first.
          </p>
        )}

        {error && (
          <p
            className="px-5 py-4 text-center text-xs text-red-400/70"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {error}
          </p>
        )}

        <AnimatePresence initial={false}>
          {comments.map((comment) => (
            <motion.div
              key={comment.id}
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="border-b border-charcoal-light/50 px-5 py-3 last:border-b-0"
            >
              <div className="flex items-start gap-3">
                {/* Author badge */}
                <div className="flex-shrink-0 pt-0.5">
                  <AuthorAvatar
                    username={comment.author?.username ?? null}
                    profileId={comment.author?.id ?? comment.profileId ?? "?"}
                  />
                </div>

                {/* Content */}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-baseline gap-2">
                    <span
                      className="truncate text-xs font-medium text-cream/70"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {comment.author?.username ||
                        (comment.profileId ?? "anon").slice(0, 6) + "..."}
                    </span>
                    <span
                      className="flex-shrink-0 text-[10px] text-muted"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {formatRelativeTime(comment.createdAt)}
                    </span>
                  </div>
                  <p
                    className="text-sm leading-relaxed text-cream/80"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    {comment.text}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Input area */}
      <div className="border-t border-charcoal-light px-4 py-3">
        {userProfileId ? (
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Add a comment..."
              maxLength={500}
              aria-label="Add a comment"
              className="min-w-0 flex-1 rounded-md border border-charcoal-light bg-jet px-3 py-2 text-sm text-cream placeholder-cream/20 outline-none transition-colors focus:border-gold/40 focus:ring-1 focus:ring-gold/20"
              style={{ fontFamily: "var(--font-sans)" }}
            />
            <button
              type="submit"
              disabled={posting || !inputText.trim()}
              className="flex h-9 items-center justify-center rounded-md bg-gold px-4 text-[11px] font-semibold tracking-[0.1em] text-jet uppercase transition-all duration-200 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-40"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {posting ? <Spinner className="h-4 w-4" /> : "Post"}
            </button>
          </form>
        ) : (
          <p
            className="py-1 text-center text-xs text-cream/25"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Connect wallet to comment
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AuthorAvatar({
  username,
  profileId,
}: {
  username: string | null;
  profileId: string;
}) {
  const letter = username
    ? username.charAt(0).toUpperCase()
    : profileId.charAt(0).toUpperCase();

  // Deterministic hue from profileId.
  let hash = 0;
  for (let i = 0; i < profileId.length; i++) {
    hash = profileId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;

  return (
    <div
      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-jet"
      style={{
        backgroundColor: `hsl(${hue}, 45%, 65%)`,
        fontFamily: "var(--font-sans)",
      }}
    >
      {letter}
    </div>
  );
}

