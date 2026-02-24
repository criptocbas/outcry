import { NextRequest, NextResponse } from "next/server";

const TAPESTRY_BASE = "https://api.usetapestry.dev/api/v1";
const API_KEY = process.env.TAPESTRY_API_KEY;

/**
 * Ensure a Tapestry content node exists for this auction.
 * Uses findOrCreate so the first call creates it, subsequent calls are no-ops.
 */
async function ensureContentNode(contentId: string, profileId: string) {
  await fetch(`${TAPESTRY_BASE}/contents/findOrCreate?apiKey=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: contentId,
      profileId,
      properties: [
        { key: "content", value: `Auction ${contentId}` },
        { key: "contentType", value: "auction" },
      ],
    }),
  });
}

export async function GET(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "Tapestry not configured" },
      { status: 503 }
    );
  }

  const contentId = req.nextUrl.searchParams.get("contentId");
  const limit = req.nextUrl.searchParams.get("limit") || "20";
  const offset = req.nextUrl.searchParams.get("offset") || "0";

  if (!contentId) {
    return NextResponse.json(
      { error: "contentId is required" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      `${TAPESTRY_BASE}/comments?contentId=${encodeURIComponent(contentId)}&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}&apiKey=${API_KEY}`
    );

    // If content node doesn't exist yet, return empty rather than error
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg = JSON.stringify(data);
      if (msg.includes("Can't find nodes") || msg.includes("not found")) {
        return NextResponse.json({ comments: [], pagination: { total: 0, limit: 20, offset: 0, hasMore: false } });
      }
      return NextResponse.json(data, { status: res.status });
    }

    const data = await res.json();

    // Tapestry returns: { comments: [{ comment: { id, text, created_at }, author: { id, username }, ... }] }
    // Normalize to our flat Comment interface.
    const rawComments = data.comments ?? data ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comments = (Array.isArray(rawComments) ? rawComments : []).map((entry: any, i: number) => {
      const c = entry.comment ?? entry;
      const author = entry.author ?? null;
      const createdMs = c.created_at ?? c.createdAt;
      const createdAt = typeof createdMs === "number"
        ? new Date(createdMs).toISOString()
        : (createdMs ?? new Date().toISOString());

      return {
        id: c.id ?? `comment-${i}-${Date.now()}`,
        profileId: author?.id ?? c.profileId ?? "",
        contentId: c.contentId ?? contentId,
        text: c.text ?? c.content ?? "",
        createdAt,
        updatedAt: createdAt,
        author: author ? { id: author.id, username: author.username ?? author.id } : null,
      };
    });

    return NextResponse.json({
      comments,
      pagination: data.pagination ?? { total: comments.length, limit: 20, offset: 0, hasMore: false },
    });
  } catch (error) {
    console.error("Tapestry comments fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch comments" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "Tapestry not configured" },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const { profileId, contentId, text } = body;

    if (!profileId || !contentId || !text) {
      return NextResponse.json(
        { error: "profileId, contentId, and text are required" },
        { status: 400 }
      );
    }

    // Ensure the content node exists before attaching a comment
    await ensureContentNode(contentId, profileId);

    const res = await fetch(`${TAPESTRY_BASE}/comments?apiKey=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId,
        contentId,
        text,
        blockchain: "SOLANA",
        execution: "FAST_UNCONFIRMED",
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    // Normalize response to match our Comment interface
    const normalized = {
      id: data.id ?? `comment-${Date.now()}`,
      profileId: data.profileId ?? profileId,
      contentId: data.contentId ?? contentId,
      text: data.text ?? text,
      createdAt: data.createdAt ?? new Date().toISOString(),
      updatedAt: data.updatedAt ?? new Date().toISOString(),
      author: data.author ?? { id: profileId, username: profileId },
    };

    return NextResponse.json(normalized);
  } catch (error) {
    console.error("Tapestry comment create error:", error);
    return NextResponse.json(
      { error: "Failed to create comment" },
      { status: 500 }
    );
  }
}
