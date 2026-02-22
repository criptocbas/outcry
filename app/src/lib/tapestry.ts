/**
 * Tapestry Social Protocol — typed client.
 * All calls go through our Next.js API routes to keep the API key server-side.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TapestryProfile {
  id: string;
  username: string;
  bio?: string;
  walletAddress: string;
  blockchain: string;
  namespace?: string;
  customProperties?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface SocialCounts {
  followers: number;
  following: number;
  posts: number;
  likes: number;
}

export interface ProfileWithCounts {
  profile: TapestryProfile;
  socialCounts: SocialCounts;
}

export interface FollowStatus {
  isFollowing: boolean;
  followId?: string;
  followedAt?: string;
}

export interface Comment {
  id: string;
  profileId: string;
  contentId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  author?: {
    id: string;
    username: string;
    profileImage?: string;
  };
}

export interface ContentItem {
  id: string;
  profileId: string;
  content: string;
  contentType: string;
  customProperties?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface LikeStatus {
  hasLiked: boolean;
  likeId?: string;
  likedAt?: string;
}

export interface PaginatedComments {
  comments: Comment[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

// ---------------------------------------------------------------------------
// Client functions (call our API routes)
// ---------------------------------------------------------------------------

const API_BASE = "/api/tapestry";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = `Tapestry API error: ${res.status}`;
    if (body) {
      try {
        const parsed = JSON.parse(body);
        message = parsed.error || parsed.message || message;
      } catch {
        message = body;
      }
    }
    throw new Error(message);
  }
  return res.json();
}

// -- Profiles ---------------------------------------------------------------

export async function getProfile(
  walletAddress: string
): Promise<ProfileWithCounts | null> {
  try {
    const raw = await fetchJson<Record<string, unknown>>(
      `${API_BASE}/profile/${encodeURIComponent(walletAddress)}`
    );

    const profile = (raw.profile ?? raw) as ProfileWithCounts["profile"];
    const partial = (raw.socialCounts ?? {}) as Partial<SocialCounts>;
    const socialCounts: SocialCounts = {
      followers: partial.followers ?? 0,
      following: partial.following ?? 0,
      posts: partial.posts ?? 0,
      likes: partial.likes ?? 0,
    };

    return { profile, socialCounts };
  } catch {
    return null;
  }
}

export async function findOrCreateProfile(
  walletAddress: string,
  username: string
): Promise<ProfileWithCounts> {
  const raw = await fetchJson<Record<string, unknown>>(`${API_BASE}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, username }),
  });

  // Tapestry's findOrCreate response may omit socialCounts — provide defaults
  const profile = (raw.profile ?? raw) as ProfileWithCounts["profile"];
  const socialCounts = (raw.socialCounts ?? {
    followers: 0,
    following: 0,
    posts: 0,
    likes: 0,
  }) as SocialCounts;

  return { profile, socialCounts };
}

export async function updateUsername(
  profileId: string,
  username: string
): Promise<ProfileWithCounts> {
  const raw = await fetchJson<Record<string, unknown>>(
    `${API_BASE}/profile/${encodeURIComponent(profileId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    }
  );

  const profile = (raw.profile ?? raw) as ProfileWithCounts["profile"];
  const partial = (raw.socialCounts ?? {}) as Partial<SocialCounts>;
  const socialCounts: SocialCounts = {
    followers: partial.followers ?? 0,
    following: partial.following ?? 0,
    posts: partial.posts ?? 0,
    likes: partial.likes ?? 0,
  };

  return { profile, socialCounts };
}

// -- Follows ----------------------------------------------------------------

export async function checkFollowStatus(
  followerId: string,
  followeeId: string
): Promise<FollowStatus> {
  return fetchJson<FollowStatus>(
    `${API_BASE}/follow/check?followerId=${encodeURIComponent(followerId)}&followeeId=${encodeURIComponent(followeeId)}`
  );
}

export async function followUser(
  startId: string,
  endId: string
): Promise<void> {
  await fetchJson(`${API_BASE}/follow`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startId, endId }),
  });
}

export async function unfollowUser(
  startId: string,
  endId: string
): Promise<void> {
  await fetchJson(`${API_BASE}/follow`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startId, endId }),
  });
}

export async function getFollowers(
  profileId: string,
  limit = 20,
  offset = 0
): Promise<{ profiles: ProfileWithCounts[]; total: number }> {
  return fetchJson(
    `${API_BASE}/followers/${encodeURIComponent(profileId)}?limit=${limit}&offset=${offset}`
  );
}

export async function getFollowing(
  profileId: string,
  limit = 20,
  offset = 0
): Promise<{ profiles: ProfileWithCounts[]; total: number }> {
  return fetchJson(
    `${API_BASE}/following/${encodeURIComponent(profileId)}?limit=${limit}&offset=${offset}`
  );
}

// -- Content ----------------------------------------------------------------

export async function createContent(
  profileId: string,
  content: string,
  properties?: Record<string, string>
): Promise<ContentItem> {
  return fetchJson<ContentItem>(`${API_BASE}/content`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, content, customProperties: properties }),
  });
}

export async function getContentByProfile(
  profileId: string,
  limit = 10,
  offset = 0
): Promise<ContentItem[]> {
  return fetchJson<ContentItem[]>(
    `${API_BASE}/content/profile/${encodeURIComponent(profileId)}?limit=${limit}&offset=${offset}`
  );
}

// -- Comments ---------------------------------------------------------------

export async function getComments(
  contentId: string,
  limit = 20,
  offset = 0
): Promise<PaginatedComments> {
  return fetchJson<PaginatedComments>(
    `${API_BASE}/comments?contentId=${encodeURIComponent(contentId)}&limit=${limit}&offset=${offset}`
  );
}

export async function postComment(
  profileId: string,
  contentId: string,
  text: string
): Promise<Comment> {
  return fetchJson<Comment>(`${API_BASE}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, contentId, text }),
  });
}

export async function deleteComment(commentId: string): Promise<void> {
  await fetchJson(`${API_BASE}/comments/${encodeURIComponent(commentId)}`, {
    method: "DELETE",
  });
}

// -- Likes ------------------------------------------------------------------

export async function checkLikeStatus(
  profileId: string,
  contentId: string
): Promise<LikeStatus> {
  return fetchJson<LikeStatus>(
    `${API_BASE}/like/check?profileId=${encodeURIComponent(profileId)}&contentId=${encodeURIComponent(contentId)}`
  );
}

export async function likeContent(
  profileId: string,
  contentId: string
): Promise<void> {
  await fetchJson(`${API_BASE}/like`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, contentId }),
  });
}

export async function unlikeContent(
  profileId: string,
  contentId: string
): Promise<void> {
  await fetchJson(`${API_BASE}/like`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, contentId }),
  });
}

export async function getLikeCount(contentId: string): Promise<number> {
  const res = await fetchJson<{ count: number }>(
    `${API_BASE}/like/count/${encodeURIComponent(contentId)}`
  );
  return res.count;
}
