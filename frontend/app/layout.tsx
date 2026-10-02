import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Caterium — Public Demo",
  description:
    "Explore Caterium's equities brokerage and Kalshi-style prediction markets with simulated orders, portfolios, and settlement.",
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
