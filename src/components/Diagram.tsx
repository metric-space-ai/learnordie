export function Diagram({ type }: { type: "bearing" | "formula" | "ramp" }) {
  if (type === "formula") {
    return (
      <svg viewBox="0 0 360 220" role="img" aria-label="Sommerfeldzahl">
        <rect x="48" y="50" width="264" height="120" rx="12" fill="oklch(91.5% 0.025 230)" stroke="oklch(58% 0.04 235)" strokeWidth="3" />
        <text x="180" y="104" textAnchor="middle" fontSize="30" fontWeight="800" fill="oklch(19% 0.034 235)">S = f(η, n, p, ψ)</text>
        <text x="180" y="142" textAnchor="middle" fontSize="17" fontWeight="700" fill="oklch(48% 0.034 235)">Viskosität / Drehzahl / Last / Spiel</text>
      </svg>
    );
  }

  if (type === "ramp") {
    return (
      <svg viewBox="0 0 360 220" role="img" aria-label="Filmaufbau beim Anfahren">
        <path d="M62 168 H308" stroke="oklch(55% 0.035 235)" strokeWidth="3" />
        <path d="M78 168 C130 166 148 132 174 106 C205 74 238 58 292 54" fill="none" stroke="oklch(56% 0.11 236)" strokeWidth="8" strokeLinecap="round" />
        <circle cx="110" cy="160" r="11" fill="oklch(57% 0.145 25)" />
        <circle cx="220" cy="72" r="11" fill="oklch(58% 0.13 150)" />
        <text x="110" y="194" textAnchor="middle" fontSize="15" fontWeight="800" fill="oklch(48% 0.034 235)">Start</text>
        <text x="220" y="42" textAnchor="middle" fontSize="15" fontWeight="800" fill="oklch(48% 0.034 235)">Filmaufbau</text>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 360 220" role="img" aria-label="Gleitlagerung Diagramm">
      <rect x="42" y="34" width="276" height="136" rx="68" fill="oklch(88% 0.025 230)" stroke="oklch(58% 0.04 235)" strokeWidth="3" />
      <circle cx="178" cy="102" r="50" fill="oklch(98% 0.005 230)" stroke="oklch(40% 0.04 235)" strokeWidth="5" />
      <path d="M130 113 C154 142 218 143 233 86" fill="none" stroke="oklch(62% 0.14 72)" strokeWidth="11" strokeLinecap="round" />
      <path d="M70 194 H310" stroke="oklch(55% 0.035 235)" strokeWidth="2" />
      <path d="M84 194 C124 154 156 156 184 181 C213 207 244 186 296 78" fill="none" stroke="oklch(56% 0.11 236)" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
