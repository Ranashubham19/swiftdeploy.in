import type { Metadata } from "next";
import { DM_Sans, Syne } from "next/font/google";

import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "ClawCloud - Your AI Agent on WhatsApp",
  description:
    "ClawCloud - Your personal AI agent on WhatsApp. Clears your inbox, drafts emails, reminds you of meetings. Two minute setup. No code needed.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${syne.variable}`}>{children}</body>
    </html>
  );
}
