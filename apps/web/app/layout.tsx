import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "slidr",
  description: "Voice-driven slide presenter",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-ink antialiased">{children}</body>
    </html>
  );
}
