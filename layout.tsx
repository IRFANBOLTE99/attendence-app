import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Attendance App",
  description: "Premium attendance app for youth and colleges.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#f4f5f7] text-slate-900 antialiased">{children}</body>
    </html>
  );
}
