import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Caterium — Public Demo",
  description:
    "Caterium: an Alpaca-based equities brokerage and Kalshi strategy-testing workspace. Explore synthetic portfolios, paper tests, and Gmail alert previews.",
  icons: { icon: "/caterium-logo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
