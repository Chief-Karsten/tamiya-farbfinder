import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { TAMIYA_COLORS, type TamiyaColor } from "@/lib/tamiya-colors";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tamiya Farbfinder – Bildfarben analysieren" },
      {
        name: "description",
        content:
          "Lade ein Bild hoch, analysiere die dominanten Farben und finde die passenden Tamiya-Farben dazu.",
      },
      { property: "og:title", content: "Tamiya Farbfinder" },
      {
        property: "og:description",
        content:
          "Dominante Bildfarben automatisch den nächstgelegenen Tamiya-Farben zuordnen.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: RGB): string {
  const c = (n: number) => n.toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// sRGB -> linear
function srgbToLinear(v: number) {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

// Linear RGB -> XYZ (D65) -> Lab
function rgbToLab({ r, g, b }: RGB): [number, number, number] {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  const xn = 0.95047,
    yn = 1.0,
    zn = 1.08883;
  const f = (t: number) =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(X / xn),
    fy = f(Y / yn),
    fz = f(Z / zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE(a: [number, number, number], b: [number, number, number]) {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
  );
}

// Precompute Tamiya Lab values
const TAMIYA_LAB = TAMIYA_COLORS.map((c) => ({
  color: c,
  lab: rgbToLab(hexToRgb(c.hex)),
}));

function nearestTamiya(rgb: RGB): { color: TamiyaColor; distance: number } {
  const lab = rgbToLab(rgb);
  let best = TAMIYA_LAB[0];
  let bestD = Infinity;
  for (const t of TAMIYA_LAB) {
    const d = deltaE(lab, t.lab);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return { color: best.color, distance: bestD };
}

// Simple color quantization: bucket by reduced-precision RGB, then pick top clusters.
function extractDominantColors(
  imgData: Uint8ClampedArray,
  count: number,
): { rgb: RGB; weight: number }[] {
  const buckets = new Map<
    string,
    { r: number; g: number; b: number; n: number }
  >();
  const step = 4 * 4; // sample every 4th pixel
  for (let i = 0; i < imgData.length; i += step) {
    const a = imgData[i + 3];
    if (a < 125) continue;
    const r = imgData[i];
    const g = imgData[i + 1];
    const b = imgData[i + 2];
    // Reduce to 5 bits per channel
    const key = `${r >> 3}-${g >> 3}-${b >> 3}`;
    const cur = buckets.get(key);
    if (cur) {
      cur.r += r;
      cur.g += g;
      cur.b += b;
      cur.n += 1;
    } else {
      buckets.set(key, { r, g, b, n: 1 });
    }
  }
  const total = Array.from(buckets.values()).reduce((s, v) => s + v.n, 0) || 1;
  const sorted = Array.from(buckets.values()).sort((a, b) => b.n - a.n);
  return sorted.slice(0, count).map((v) => ({
    rgb: {
      r: Math.round(v.r / v.n),
      g: Math.round(v.g / v.n),
      b: Math.round(v.b / v.n),
    },
    weight: v.n / total,
  }));
}

interface Result {
  rgb: RGB;
  hex: string;
  weight: number;
  match: TamiyaColor;
  distance: number;
}

function Index() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(6);
  const fileRef = useRef<HTMLInputElement>(null);

  const analyze = (url: string, n: number) => {
    setLoading(true);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const maxSize = 200;
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setLoading(false);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const dominant = extractDominantColors(data, n);
      const res: Result[] = dominant.map((d) => {
        const match = nearestTamiya(d.rgb);
        return {
          rgb: d.rgb,
          hex: rgbToHex(d.rgb),
          weight: d.weight,
          match: match.color,
          distance: match.distance,
        };
      });
      setResults(res);
      setLoading(false);
    };
    img.onerror = () => setLoading(false);
    img.src = url;
  };

  const onFile = (file: File) => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    analyze(url, count);
  };

  const onCountChange = (n: number) => {
    setCount(n);
    if (imageUrl) analyze(imageUrl, n);
  };

  const sorted = useMemo(
    () => (results ? [...results].sort((a, b) => b.weight - a.weight) : null),
    [results],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">
            Tamiya Farbfinder
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Lade ein Bild hoch. Die dominanten Farben werden analysiert und den
            nächstgelegenen Tamiya-Farben (X / XF) zugeordnet.
          </p>
        </header>

        <div className="rounded-lg border border-border bg-card p-6">
          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Bild auswählen
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Anzahl Farben:
              <select
                value={count}
                onChange={(e) => onCountChange(Number(e.target.value))}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                {[3, 5, 6, 8, 10, 12].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {loading && (
              <span className="text-sm text-muted-foreground">
                Analysiere…
              </span>
            )}
          </div>

          {imageUrl && (
            <div className="mt-6">
              <img
                src={imageUrl}
                alt="Hochgeladenes Bild"
                className="max-h-80 rounded-md border border-border object-contain"
              />
            </div>
          )}
        </div>

        {sorted && sorted.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-4 text-xl font-semibold">Ergebnisse</h2>
            <div className="grid gap-3">
              {sorted.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 rounded-lg border border-border bg-card p-3"
                >
                  <div
                    className="h-14 w-14 shrink-0 rounded-md border border-border"
                    style={{ backgroundColor: r.hex }}
                    title={`Bildfarbe ${r.hex}`}
                  />
                  <div className="text-sm">
                    <div className="font-mono text-xs text-muted-foreground">
                      {r.hex}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {(r.weight * 100).toFixed(1)}% Anteil
                    </div>
                  </div>
                  <div className="mx-2 text-muted-foreground">→</div>
                  <div
                    className="h-14 w-14 shrink-0 rounded-md border border-border"
                    style={{ backgroundColor: r.match.hex }}
                    title={`Tamiya ${r.match.code}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">
                      {r.match.code} – {r.match.name}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {r.match.hex} · ΔE {r.distance.toFixed(1)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Hinweis: Die Tamiya-Referenzwerte sind Näherungswerte. ΔE ist der
              Farbabstand im Lab-Farbraum – kleiner = ähnlicher.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
