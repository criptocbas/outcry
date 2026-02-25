import { NextRequest, NextResponse } from "next/server";

const TAPESTRY_BASE = "https://api.usetapestry.dev/api/v1";
const API_KEY = process.env.TAPESTRY_API_KEY;

export async function PUT(
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
  const body = await req.json();

  // Whitelist allowed fields to prevent arbitrary data injection
  const ALLOWED_FIELDS = ["username", "bio", "image"];
  const sanitized: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in body) sanitized[key] = body[key];
  }

  try {
    const res = await fetch(
      `${TAPESTRY_BASE}/profiles/${encodeURIComponent(id)}?apiKey=${API_KEY}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sanitized),
      }
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Tapestry profile update error:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "Tapestry not configured" },
      { status: 503 }
    );
  }

  const { id } = await params;

  try {
    // Tapestry's GET /profiles/:id expects a profile ID, not a wallet address.
    // When called with a wallet address (32+ chars base58), use the query-based
    // lookup instead: GET /profiles?walletAddress=...
    const isWalletAddress = id.length >= 32 && !id.includes("_");

    let profileData: Record<string, unknown> | null = null;

    if (isWalletAddress) {
      const res = await fetch(
        `${TAPESTRY_BASE}/profiles?walletAddress=${encodeURIComponent(id)}&apiKey=${API_KEY}`
      );
      const data = await res.json();

      if (!res.ok) {
        return NextResponse.json(data, { status: res.status });
      }

      // Response shape: { profiles: [...], totalCount }
      const profiles = data.profiles ?? [];
      if (profiles.length === 0) {
        return NextResponse.json(
          { error: "Profile not found" },
          { status: 404 }
        );
      }
      profileData = profiles[0];
    } else {
      const res = await fetch(
        `${TAPESTRY_BASE}/profiles/${encodeURIComponent(id)}?apiKey=${API_KEY}`
      );
      const data = await res.json();

      if (!res.ok) {
        return NextResponse.json(data, { status: res.status });
      }
      profileData = data;
    }

    return NextResponse.json(profileData);
  } catch (error) {
    console.error("Tapestry profile fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  }
}
