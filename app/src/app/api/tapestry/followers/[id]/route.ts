import { NextRequest, NextResponse } from "next/server";

const TAPESTRY_BASE = "https://api.usetapestry.dev/api/v1";
const API_KEY = process.env.TAPESTRY_API_KEY;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "Tapestry not configured" },
      { status: 503 }
    );
  }

  const { id } = await params;
  const limit = String(Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "20", 10) || 20)));
  const offset = String(Math.min(10000, Math.max(0, parseInt(req.nextUrl.searchParams.get("offset") || "0", 10) || 0)));

  try {
    const res = await fetch(
      `${TAPESTRY_BASE}/profiles/${encodeURIComponent(id)}/followers?apiKey=${API_KEY}&page=1&pageSize=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    // Normalize profiles: Tapestry returns wallet.id, we need walletAddress
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profiles = (data.profiles ?? []).map((p: any) => ({
      profile: {
        id: p.id ?? p.username,
        username: p.username ?? p.id,
        walletAddress: p.wallet?.id ?? p.walletAddress ?? "",
        bio: p.bio ?? null,
      },
      socialCounts: p.socialCounts ?? { followers: 0, following: 0, posts: 0, likes: 0 },
    }));

    return NextResponse.json({ profiles, total: data.totalCount ?? profiles.length });
  } catch (error) {
    console.error("Tapestry followers fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch followers" },
      { status: 500 }
    );
  }
}
