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
      `${TAPESTRY_BASE}/contents/profile/${encodeURIComponent(id)}?apiKey=${API_KEY}&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Tapestry content by profile error:", error);
    return NextResponse.json(
      { error: "Failed to fetch content" },
      { status: 500 }
    );
  }
}
