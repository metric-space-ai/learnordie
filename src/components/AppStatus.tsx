import Link from "next/link";

/** The same entry island is used for route failures, never framework-default UI. */
export function AppStatus({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="join-screen app-canvas app-status-screen">
      <section className="join-card app-island app-status-card" aria-labelledby="app-status-title">
        <span className="app-status-brand">learnordie.app</span>
        <h1 id="app-status-title">{title}</h1>
        {children}
        <Link className="join-back" href="/">Zur Startseite</Link>
      </section>
    </main>
  );
}
