import type { Metadata, Viewport } from "next";

import "@learnordie/slide-engine/styles/core.css";
import "@learnordie/slide-engine/styles/themes/learnordie-north.css";
import "@learnordie/slide-engine/styles/themes/learnordie-technical.css";
import "@learnordie/slide-engine/styles/themes/learnordie-dark-room.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "learnordie.app",
  description: "Lernen im Norden: quiz-augmentierte Vorlesungen mit Live-Modus, Lernrunden und KI-Erklärungen",
  icons: {
    icon: "/icon.svg"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
