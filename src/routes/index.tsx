import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import jsPDF from "jspdf";
import { TAMIYA_COLORS, type TamiyaColor } from "@/lib/tamiya-colors";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tamiya Farbfinder – Farben per Pipette auswählen" },
      {
        name: "description",
        content:
          "Lade ein Bild hoch, wähle Farben per Pipette und finde die passenden Tamiya-Farben. Liste als PDF exportieren.",
      },
      { property: "og:title", content: "Tamiya Farbfinder" },
      {
        property: "og:description",
        content:
          "Farben per Pipette aus einem Bild wählen und passende Tamiya-Töne als PDF exportieren.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type RGB = { r: number; g: number; b: number };

function rgbToHex({ r, g, b }: RGB): string {
  const c = (n: number) => n.toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function srgbToLinear(v: number) {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

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

const TAMIYA_LAB = TAMIYA_COLORS.map((c) => ({
  color: c,
  lab: rgbToLab(hexToRgb(c.hex)),
}));

function nearestTamiya(
  rgb: RGB,
  n: number,
): { color: TamiyaColor; distance: number }[] {
  const lab = rgbToLab(rgb);
  return TAMIYA_LAB.map((t) => ({
    color: t.color,
    distance: deltaE(lab, t.lab),
  }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, n);
}

interface PickEntry {
  id: string;
  hex: string;
  rgb: RGB;
  matches: { color: TamiyaColor; distance: number }[];
}

function Index() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [hoverColor, setHoverColor] = useState<string | null>(null);
  const [entries, setEntries] = useState<PickEntry[]>([]);
  const [matchCount, setMatchCount] = useState(3);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const onFile = (file: File) => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setEntries([]);
    canvasRef.current = null;
  };

  const ensureCanvas = (): HTMLCanvasElement | null => {
    if (canvasRef.current) return canvasRef.current;
    const img = imgRef.current;
    if (!img) return null;
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    canvasRef.current = c;
    return c;
  };

  const pixelAt = (e: React.MouseEvent<HTMLImageElement>): RGB | null => {
    const img = imgRef.current;
    const c = ensureCanvas();
    if (!img || !c) return null;
    const rect = img.getBoundingClientRect();
    const x = Math.floor(
      ((e.clientX - rect.left) / rect.width) * img.naturalWidth,
    );
    const y = Math.floor(
      ((e.clientY - rect.top) / rect.height) * img.naturalHeight,
    );
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const d = ctx.getImageData(
      Math.max(0, Math.min(c.width - 1, x)),
      Math.max(0, Math.min(c.height - 1, y)),
      1,
      1,
    ).data;
    return { r: d[0], g: d[1], b: d[2] };
  };

  const onMove = (e: React.MouseEvent<HTMLImageElement>) => {
    const rgb = pixelAt(e);
    if (rgb) setHoverColor(rgbToHex(rgb));
  };

  const onClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const rgb = pixelAt(e);
    if (!rgb) return;
    const hex = rgbToHex(rgb);
    const matches = nearestTamiya(rgb, matchCount);
    setEntries((prev) => [
      ...prev,
      { id: crypto.randomUUID(), hex, rgb, matches },
    ]);
  };

  const removeEntry = (id: string) =>
    setEntries((prev) => prev.filter((e) => e.id !== id));

  const clearAll = () => setEntries([]);

  const exportPdf = () => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 15;
    let y = margin;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Tamiya Farbliste", margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(
      `Erstellt am ${new Date().toLocaleDateString("de-DE")} · ${entries.length} Farben`,
      margin,
      y,
    );
    doc.setTextColor(0);
    y += 8;

    const swatch = 10;
    const rowH = 16;

    entries.forEach((entry, idx) => {
      if (y + rowH + 4 > pageH - margin) {
        doc.addPage();
        y = margin;
      }

      // Picked color swatch
      doc.setFillColor(entry.rgb.r, entry.rgb.g, entry.rgb.b);
      doc.setDrawColor(200);
      doc.rect(margin, y, swatch, swatch, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`#${idx + 1}  ${entry.hex.toUpperCase()}`, margin + swatch + 4, y + 4);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(90);
      doc.text("Nächste Tamiya-Farben:", margin + swatch + 4, y + 9);
      doc.setTextColor(0);

      // Matches
      let mx = margin + swatch + 4;
      let my = y + 11;
      entry.matches.forEach((m) => {
        const rgb = hexToRgb(m.color.hex);
        doc.setFillColor(rgb.r, rgb.g, rgb.b);
        doc.setDrawColor(200);
        doc.rect(mx, my, 5, 5, "FD");
        doc.setFontSize(9);
        const label = `${m.color.code} ${m.color.name} (ΔE ${m.distance.toFixed(1)})`;
        doc.text(label, mx + 7, my + 4);
        const w = doc.getTextWidth(label) + 12;
        mx += w;
        if (mx > pageW - margin - 40) {
          mx = margin + swatch + 4;
          my += 6;
        }
      });

      y += rowH + 2;
      doc.setDrawColor(230);
      doc.line(margin, y, pageW - margin, y);
      y += 3;
    });

    doc.save(`tamiya-farbliste-${Date.now()}.pdf`);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">
            Tamiya Farbfinder
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Lade ein Bild hoch, klicke mit der Pipette auf Farben und
            exportiere die passenden Tamiya-Töne als PDF.
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
              Treffer pro Klick:
              <select
                value={matchCount}
                onChange={(e) => setMatchCount(Number(e.target.value))}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                {[2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {hoverColor && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span
                  className="inline-block h-5 w-5 rounded border border-border"
                  style={{ backgroundColor: hoverColor }}
                />
                <span className="font-mono text-xs">{hoverColor}</span>
              </div>
            )}
          </div>

          {imageUrl && (
            <div className="mt-6">
              <img
                ref={imgRef}
                src={imageUrl}
                alt="Hochgeladenes Bild"
                onMouseMove={onMove}
                onMouseLeave={() => setHoverColor(null)}
                onClick={onClick}
                crossOrigin="anonymous"
                className="max-h-[500px] cursor-crosshair rounded-md border border-border object-contain"
                onLoad={() => {
                  canvasRef.current = null;
                }}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Klicke auf das Bild, um eine Farbe zur Liste hinzuzufügen.
              </p>
            </div>
          )}
        </div>

        {entries.length > 0 && (
          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                Farbliste ({entries.length})
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={clearAll}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
                >
                  Leeren
                </button>
                <button
                  onClick={exportPdf}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Als PDF herunterladen
                </button>
              </div>
            </div>

            <div className="grid gap-3">
              {entries.map((entry, idx) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="h-12 w-12 shrink-0 rounded-md border border-border"
                      style={{ backgroundColor: entry.hex }}
                    />
                    <div className="text-sm">
                      <div className="font-semibold">#{idx + 1}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {entry.hex}
                      </div>
                    </div>
                    <div className="ml-auto">
                      <button
                        onClick={() => removeEntry(entry.id)}
                        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                      >
                        Entfernen
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {entry.matches.map((m) => (
                      <div
                        key={m.color.code}
                        className="flex items-center gap-2 rounded-md border border-border p-2"
                      >
                        <div
                          className="h-8 w-8 shrink-0 rounded border border-border"
                          style={{ backgroundColor: m.color.hex }}
                        />
                        <div className="min-w-0 text-xs">
                          <div className="truncate font-semibold">
                            {m.color.code} – {m.color.name}
                          </div>
                          <div className="font-mono text-muted-foreground">
                            {m.color.hex} · ΔE {m.distance.toFixed(1)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
