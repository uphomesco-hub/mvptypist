import type { Metadata } from "next";
import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://raddie.in";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"]
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600"]
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "raddie.ai",
  alternates: {
    canonical: "/"
  },
  title: "raddie.ai",
  description: "Template-aware radiology dictation, drafting, and report review workspace.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: ["/favicon.ico"]
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "raddie.ai",
    title: "raddie.ai",
    description: "Template-aware radiology dictation, drafting, and report review workspace.",
    images: [
      {
        url: "/raddie.png",
        width: 1024,
        height: 1024,
        alt: "raddie.ai logo"
      }
    ]
  },
  twitter: {
    card: "summary",
    title: "raddie.ai",
    description: "Template-aware radiology dictation, drafting, and report review workspace.",
    images: ["/raddie.png"]
  }
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${plexSans.variable}`}>
      <head>
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />
        <link
          href="https://fonts.googleapis.com/icon?family=Material+Icons+Round"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
