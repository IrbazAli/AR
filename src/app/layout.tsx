import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Akasha Relic Tech - AR MVP",
  description: "Month 1 MVP for AR Memorial Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
