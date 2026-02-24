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
    return NextResponse.json(data);
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

    return NextResponse.json(data);
  } catch (error) {
    console.error("Tapestry comment create error:", error);
    return NextResponse.json(
      { error: "Failed to create comment" },
      { status: 500 }
    );
  }
}
