import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Waverly Advisors - Tear Sheet Generator",
  description: "Professional equity research tear sheet generator",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
