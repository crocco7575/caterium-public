import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Caterium / Public Engineering Workspace",
  description: "A synthetic, inspectable order lifecycle workspace.",
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
