import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  truncateAddress,
  formatSOL,
  formatTimeRemaining,
  getStatusColor,
  getStatusLabel,
} from "@/lib/utils";

// ---------------------------------------------------------------------------
// truncateAddress
// ---------------------------------------------------------------------------
describe("truncateAddress", () => {
  const addr = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";

  it("truncates with default chars (4)", () => {
    const result = truncateAddress(addr);
    expect(result).toBe("7EcD...FLtV");
    expect(result.length).toBeLessThan(addr.length);
  });

  it("truncates with custom chars", () => {
    expect(truncateAddress(addr, 6)).toBe("7EcDhS...wCFLtV");
  });

  it("returns short address unchanged", () => {
    expect(truncateAddress("ABCD")).toBe("ABCD");
  });

  it("handles exactly 2*chars length", () => {
    expect(truncateAddress("ABCDEFGH", 4)).toBe("ABCDEFGH");
  });
});

// ---------------------------------------------------------------------------
// formatSOL
// ---------------------------------------------------------------------------
describe("formatSOL", () => {
  it("formats 1 SOL", () => {
    expect(formatSOL(LAMPORTS_PER_SOL)).toBe("1.00");
  });

  it("formats fractional SOL", () => {
    expect(formatSOL(LAMPORTS_PER_SOL * 1.5)).toBe("1.50");
  });

  it("formats zero", () => {
    expect(formatSOL(0)).toBe("0.00");
  });

  it("formats large amounts", () => {
    expect(formatSOL(LAMPORTS_PER_SOL * 1000)).toBe("1,000.00");
  });

  it("formats small lamport values", () => {
    // 0.01 SOL
    expect(formatSOL(10_000_000)).toBe("0.01");
  });
});

// ---------------------------------------------------------------------------
// formatTimeRemaining
// ---------------------------------------------------------------------------
describe("formatTimeRemaining", () => {
  let now: number;

  beforeEach(() => {
    now = Math.floor(Date.now() / 1000);
    vi.useFakeTimers();
    vi.setSystemTime(now * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns ENDED for past timestamps", () => {
    expect(formatTimeRemaining(now - 100)).toBe("ENDED");
  });

  it("returns ENDED for exactly now", () => {
    expect(formatTimeRemaining(now)).toBe("ENDED");
  });

  it("formats seconds and minutes", () => {
    // 5 minutes 30 seconds
    expect(formatTimeRemaining(now + 330)).toBe("5m 30s");
  });

  it("formats hours and minutes", () => {
    // 2 hours 15 minutes
    expect(formatTimeRemaining(now + 2 * 3600 + 15 * 60)).toBe("2h 15m");
  });

  it("formats days and hours", () => {
    // 3 days 5 hours
    expect(formatTimeRemaining(now + 3 * 86400 + 5 * 3600)).toBe("3d 5h");
  });

  it("formats exactly 1 minute", () => {
    expect(formatTimeRemaining(now + 60)).toBe("1m 0s");
  });
});

// ---------------------------------------------------------------------------
// getStatusColor
// ---------------------------------------------------------------------------
describe("getStatusColor", () => {
  it("returns emerald for active", () => {
    expect(getStatusColor("active")).toBe("text-emerald-400");
    expect(getStatusColor("Active")).toBe("text-emerald-400");
  });

  it("returns amber for ended", () => {
    expect(getStatusColor("ended")).toBe("text-amber-400");
  });

  it("returns gold for settled", () => {
    expect(getStatusColor("settled")).toBe("text-[#C6A961]");
  });

  it("returns red for cancelled", () => {
    expect(getStatusColor("cancelled")).toBe("text-red-400");
  });

  it("returns zinc for unknown status", () => {
    expect(getStatusColor("invalid")).toBe("text-zinc-400");
  });
});

// ---------------------------------------------------------------------------
// getStatusLabel
// ---------------------------------------------------------------------------
describe("getStatusLabel", () => {
  it("converts anchor enum to display label", () => {
    expect(getStatusLabel({ created: {} })).toBe("Created");
    expect(getStatusLabel({ active: {} })).toBe("Active");
    expect(getStatusLabel({ ended: {} })).toBe("Ended");
    expect(getStatusLabel({ settled: {} })).toBe("Settled");
    expect(getStatusLabel({ cancelled: {} })).toBe("Cancelled");
  });

  it("returns Unknown for empty object", () => {
    expect(getStatusLabel({})).toBe("Unknown");
  });
});
