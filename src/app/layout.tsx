import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Akasha Relic Tech - AR MVP",
  description: "Month 1 MVP for AR Memorial Platform",
};

import Script from "next/script";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js" strategy="lazyOnload" />
      </body>
    </html>
  );
}
