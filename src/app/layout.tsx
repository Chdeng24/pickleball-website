import type { Metadata, Viewport } from "next";
import { Archivo, Inter } from "next/font/google";
import { Toaster } from "sonner";
import { club } from "@/lib/content";
import "./globals.css";

// Display face carries the athletic weight; Inter keeps body copy readable.
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://pickleballatberkeley.com"),
  title: {
    default: `${club.name} — ${club.tagline}`,
    template: `%s — ${club.name}`,
  },
  description: club.blurb,
  openGraph: {
    title: club.name,
    description: club.blurb,
    type: "website",
    siteName: club.name,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a2a66",
};

// Deliberately no Header/Footer here — those live in (public)/layout.tsx so
// /login, /pending, and the (member) area (which has its own MemberNav) don't
// inherit the marketing chrome.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-white">
        {children}
        <Toaster position="bottom-center" richColors />
      </body>
    </html>
  );
}
