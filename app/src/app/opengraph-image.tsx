import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "OUTCRY — Live Auctions on Solana";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0A0A0A",
          fontFamily: "serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "24px",
          }}
        >
          <div
            style={{
              fontSize: "96px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "#C6A961",
            }}
          >
            OUTCRY
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 400,
              color: "#F5F0E8",
              letterSpacing: "0.04em",
              fontStyle: "italic",
            }}
          >
            Going, going, onchain.
          </div>
          <div
            style={{
              fontSize: "18px",
              fontWeight: 400,
              color: "#8A8A8A",
              marginTop: "16px",
            }}
          >
            Real-time live auctions on Solana
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
