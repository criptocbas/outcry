import type { Metadata } from "next";
import { Playfair_Display, DM_Sans } from "next/font/google";
import Providers from "@/providers/Providers";
import Header from "@/components/layout/Header";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import "./globals.css";

const playfairDisplay = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "OUTCRY — Live Auctions on Solana",
  description:
    "Going, going, onchain. Real-time live auctions powered by MagicBlock Ephemeral Rollups.",
  metadataBase: new URL("https://outcry.art"),
  openGraph: {
    title: "OUTCRY — Live Auctions on Solana",
    description:
      "Going, going, onchain. Real-time live auctions powered by MagicBlock Ephemeral Rollups.",
    type: "website",
    siteName: "OUTCRY",
  },
  twitter: {
    card: "summary_large_image",
    title: "OUTCRY — Live Auctions on Solana",
    description:
      "Going, going, onchain. Real-time live auctions powered by MagicBlock Ephemeral Rollups.",
  },
  other: {
    "theme-color": "#0A0A0A",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${playfairDisplay.variable} ${dmSans.variable} font-sans antialiased relative min-h-screen`}
      >
        <Providers>
          <Header />
          <main className="pt-16">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </Providers>
      </body>
    </html>
  );
}
