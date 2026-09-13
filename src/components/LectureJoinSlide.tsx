"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import QRCode from "qrcode";

/** No third-party QR service: the public lecture URL stays in this browser. */
export function LectureJoinSlide({ url, title, onStart, action }: {
  url: string; title: string; onStart?: () => void; action?: ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!canvas.current || !url) return;
    let cancelled = false;
    QRCode.toCanvas(canvas.current, url, {
      width: 768, margin: 4, errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" }
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url]);

  return (
    <section className="lecture-join-slide" aria-label="Vorlesung beitreten">
      <div className="lecture-join-copy">
        <h1>{title}</h1>
        <p>Teilnehmen</p>
        <a className="lecture-join-url" href={url}>{url}</a>
        {action ?? (onStart && <button className="primary-button" type="button" onClick={onStart}>Präsentation starten</button>)}
      </div>
      <div className="lecture-join-qr">
        <canvas ref={canvas} width={768} height={768} role="img" aria-label={`QR-Code zur Vorlesung: ${url}`} />
        {failed && <p role="status">QR-Code nicht verfügbar. Bitte den ausgeschriebenen Link verwenden.</p>}
      </div>
    </section>
  );
}
