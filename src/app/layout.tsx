import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { themeBootstrap } from "@/components/theme/theme-store";

import "@learnordie/slide-engine/styles/core.css";
import "@learnordie/slide-engine/styles/themes/learnordie-north.css";
import "@learnordie/slide-engine/styles/themes/learnordie-technical.css";
import "@learnordie/slide-engine/styles/themes/learnordie-dark-room.css";
import "./globals.css";
import "./ui-entry.css";
import "./ui-student.css";
import "./ui-studio.css";
import "./ui-present.css";
import "./ui-live-session.css";
import "./ui-app-design.css";
import "./ui-app-consistency.css";
import "./ui-excalidraw.css";
import "./ui-presentation-stage.css";

export const metadata: Metadata = {
  title: "learnordie.app",
  description: "Lernen im Norden: quiz-augmentierte Vorlesungen mit Live-Modus, Lernrunden und KI-Erklärungen",
  icons: {
    icon: "/icon.svg"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  interactiveWidget: "resizes-content"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script id="app-theme-init" dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body data-ui-design="excalidraw" data-release={process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12)}>
        <ThemeProvider>
          {children}
          <aside className="app-theme-control" aria-label="Darstellung">
            <ThemeToggle />
          </aside>
        </ThemeProvider>
      </body>
    </html>
  );
}
