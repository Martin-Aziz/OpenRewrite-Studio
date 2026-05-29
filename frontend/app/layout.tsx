import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenRewrite Studio",
  description: "Rewrite with clarity. Keep your voice. Own your data."
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
