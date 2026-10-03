import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import { TAMIYA_COLORS, type TamiyaColor } from "@/lib/tamiya-colors";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tamiya Farbfinder Pro" },
      {
        name: "description",
        content:
          "Foto analysieren, Tamiya-Farben finden, Mischvorschläge berechnen und eine Farbliste als PDF exportieren.",
      },
    ],
  }),
  component: Index,
});

type RGB = { r: number; g: number; b: number };
type Lab = [number, number, number];
type Match = { color: TamiyaColor; distance: number };
type MixSuggestion = {
  a: TamiyaColor;
  b: TamiyaColor;
  aPct: number;
  bPct: number;
  distance: number;
  hex: string;
};
type PickEntry = {
  id: string;
  name: string;
  hex: string;
  rgb: RGB;
  matches: Match[];
  ownedMatches: Match[];
  mix: MixSuggestion | null;
};
type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

type Series = "X" | "XF" | "LP" | "TS";

function clamp(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)));
}
function rgbToHex({ r, g, b }: RGB): string {
  const c = (n: number) => clamp(n).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
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
function rgbToLab({ r, g, b }: RGB): Lab {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  const f = (t: number) =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(X / 0.95047);
  const fy = f(Y);
  const fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function deltaE(a: Lab, b: Lab) {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
  );
}
function seriesOf(code: string): Series {
  return code.startsWith("XF-")
    ? "XF"
    : code.startsWith("LP-")
      ? "LP"
      : code.startsWith("TS-")
        ? "TS"
        : "X";
}
function seriesName(code: string) {
  const s = seriesOf(code);
  if (s === "XF") return "XF-Serie (Matt)";
  if (s === "X") return "X-Serie (Glanz)";
  if (s === "LP") return "LP-Serie (Lack)";
  return "TS-Serie (Spray)";
}

const COLOR_LAB = TAMIYA_COLORS.map((color) => ({
  color,
  lab: rgbToLab(hexToRgb(color.hex)),
}));

const OWNED_KEY = "tamiya-owned-colors";

function Index() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [entries, setEntries] = useState<PickEntry[]>([]);
  const [matchCount, setMatchCount] = useState(5);
  const [owned, setOwned] = useState<string[]>([]);
  const [ownedQuery, setOwnedQuery] = useState("");
  const [sampleRadius, setSampleRadius] = useState(4);
  const [mode, setMode] = useState<"point" | "area">("point");
  const [robustArea, setRobustArea] = useState(true);
  const [activeSeries, setActiveSeries] = useState<Series[]>([
    "X",
    "XF",
    "LP",
    "TS",
  ]);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [dominants, setDominants] = useState<RGB[]>([]);
  const [status, setStatus] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const filteredColors = useMemo(
    () => TAMIYA_COLORS.filter((c) => activeSeries.includes(seriesOf(c.code))),
    [activeSeries],
  );

  const ownedColors = useMemo(
    () => TAMIYA_COLORS.filter((c) => owned.includes(c.code)),
    [owned],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(OWNED_KEY);
      if (raw) setOwned(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(OWNED_KEY, JSON.stringify(owned));
    } catch {}
  }, [owned]);

  const toggleOwned = (code: string) =>
    setOwned((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );

  const onFile = (file: File) => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setEntries([]);
    setDominants([]);
    setSelection(null);
    setStatus("");
    canvasRef.current = null;
  };

  const ensureCanvas = (): HTMLCanvasElement | null => {
    if (canvasRef.current) return canvasRef.current;
    const img = imgRef.current;
    if (!img?.naturalWidth) return null;
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    canvasRef.current = c;
    return c;
  };

  const nearestTamiya = (rgb: RGB, n: number): Match[] => {
    const lab = rgbToLab(rgb);
    const allowed = new Set(filteredColors.map((c) => c.code));
    return COLOR_LAB.filter((t) => allowed.has(t.color.code))
      .map((t) => ({ color: t.color, distance: deltaE(lab, t.lab) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, n);
  };

  const nearestOwned = (rgb: RGB, n: number): Match[] => {
    if (!ownedColors.length) return [];
    const lab = rgbToLab(rgb);
    const allowed = new Set(ownedColors.map((c) => c.code));
    return COLOR_LAB.filter((t) => allowed.has(t.color.code))
      .map((t) => ({ color: t.color, distance: deltaE(lab, t.lab) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, n);
  };

  const bestMix = (rgb: RGB): MixSuggestion | null => {
    const lab = rgbToLab(rgb);
    const nearest = nearestTamiya(rgb, 20);
    let best: MixSuggestion | null = null;
    for (let i = 0; i < nearest.length; i++) {
      for (let j = i + 1; j < nearest.length; j++) {
        const ar = hexToRgb(nearest[i].color.hex);
        const br = hexToRgb(nearest[j].color.hex);
        for (let step = 1; step <= 9; step++) {
          const t = step / 10;
          const mixed: RGB = {
            r: ar.r * (1 - t) + br.r * t,
            g: ar.g * (1 - t) + br.g * t,
            b: ar.b * (1 - t) + br.b * t,
          };
          const d = deltaE(lab, rgbToLab(mixed));
          if (!best || d < best.distance) {
            best = {
              a: nearest[i].color,
              b: nearest[j].color,
              aPct: Math.round((1 - t) * 100),
              bPct: Math.round(t * 100),
              distance: d,
              hex: rgbToHex(mixed),
            };
          }
        }
      }
    }
    return best;
  };

  const addEntry = (rgb: RGB, suggestedName?: string) => {
    if (!filteredColors.length) {
      setStatus("Bitte mindestens eine Tamiya-Serie aktivieren.");
      return;
    }
    const index = entries.length + 1;
    setEntries((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: suggestedName ?? `Farbe ${index}`,
        rgb: { r: clamp(rgb.r), g: clamp(rgb.g), b: clamp(rgb.b) },
        hex: rgbToHex(rgb),
        matches: nearestTamiya(rgb, matchCount),
        ownedMatches: nearestOwned(rgb, 3),
        mix: bestMix(rgb),
      },
    ]);
    setStatus("");
  };

  const imagePoint = (e: React.MouseEvent<HTMLImageElement>): Point | null => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * img.naturalWidth,
      y: ((e.clientY - rect.top) / rect.height) * img.naturalHeight,
    };
  };

  const averageRect = (r: Rect, robust = false): RGB | null => {
    const c = ensureCanvas();
    if (!c) return null;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const x = Math.max(0, Math.floor(r.x));
    const y = Math.max(0, Math.floor(r.y));
    const w = Math.max(1, Math.min(c.width - x, Math.floor(r.w)));
    const h = Math.max(1, Math.min(c.height - y, Math.floor(r.h)));
    const data = ctx.getImageData(x, y, w, h).data;
    const px: { r: number; g: number; b: number; lum: number }[] = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 16) continue;
      const p = { r: data[i], g: data[i + 1], b: data[i + 2], lum: 0 };
      p.lum = 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b;
      px.push(p);
    }
    if (!px.length) return null;
    let use = px;
    if (robust && px.length >= 100) {
      const sorted = [...px].sort((a, b) => a.lum - b.lum);
      const cut = Math.floor(sorted.length * 0.1);
      use = sorted.slice(cut, sorted.length - cut);
    }
    const total = use.reduce(
      (s, p) => ({ r: s.r + p.r, g: s.g + p.g, b: s.b + p.b }),
      { r: 0, g: 0, b: 0 },
    );
    return {
      r: total.r / use.length,
      g: total.g / use.length,
      b: total.b / use.length,
    };
  };

  const pickPoint = (p: Point) => {
    const d = sampleRadius * 2 + 1;
    const rgb = averageRect(
      { x: p.x - sampleRadius, y: p.y - sampleRadius, w: d, h: d },
      false,
    );
    if (rgb) addEntry(rgb);
  };

  const onMouseDown = (e: React.MouseEvent<HTMLImageElement>) => {
    if (mode !== "area") return;
    const p = imagePoint(e);
    if (p) {
      setDragStart(p);
      setSelection({ x: p.x, y: p.y, w: 1, h: 1 });
    }
  };
  const onMouseMove = (e: React.MouseEvent<HTMLImageElement>) => {
    if (mode !== "area" || !dragStart) return;
    const p = imagePoint(e);
    if (!p) return;
    setSelection({
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      w: Math.abs(p.x - dragStart.x),
      h: Math.abs(p.y - dragStart.y),
    });
  };
  const onMouseUp = () => {
    if (mode !== "area" || !dragStart || !selection) return;
    setDragStart(null);
    if (selection.w > 4 && selection.h > 4) {
      const rgb = averageRect(selection, robustArea);
      if (rgb) addEntry(rgb, `Fläche ${entries.length + 1}`);
    }
  };
  const onClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (mode !== "point") return;
    const p = imagePoint(e);
    if (p) pickPoint(p);
  };

  const updateEntryName = (id: string, name: string) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, name } : e)));
  const removeEntry = (id: string) =>
    setEntries((prev) => prev.filter((e) => e.id !== id));

  const recalcEntries = (series = activeSeries, count = matchCount) => {
    const allowed = new Set(
      TAMIYA_COLORS.filter((c) => series.includes(seriesOf(c.code))).map(
        (c) => c.code,
      ),
    );
    setEntries((prev) =>
      prev.map((entry) => {
        const lab = rgbToLab(entry.rgb);
        const matches = COLOR_LAB.filter((t) => allowed.has(t.color.code))
          .map((t) => ({ color: t.color, distance: deltaE(lab, t.lab) }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, count);
        return { ...entry, matches };
      }),
    );
  };

  const toggleSeries = (s: Series) => {
    const next = activeSeries.includes(s)
      ? activeSeries.filter((x) => x !== s)
      : [...activeSeries, s];
    setActiveSeries(next);
    recalcEntries(next, matchCount);
  };

  const analyzeDominants = () => {
    const c = ensureCanvas();
    if (!c) return;
    const tmp = document.createElement("canvas");
    const scale = Math.min(1, 180 / Math.max(c.width, c.height));
    tmp.width = Math.max(1, Math.round(c.width * scale));
    tmp.height = Math.max(1, Math.round(c.height * scale));
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    if (!tctx) return;
    tctx.drawImage(c, 0, 0, tmp.width, tmp.height);
    const data = tctx.getImageData(0, 0, tmp.width, tmp.height).data;
    const buckets = new Map<string, number>();
    for (let i = 0; i < data.length; i += 4) {
      const r = Math.min(255, Math.round(data[i] / 32) * 32);
      const g = Math.min(255, Math.round(data[i + 1] / 32) * 32);
      const b = Math.min(255, Math.round(data[i + 2] / 32) * 32);
      const key = `${r},${g},${b}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    const chosen: RGB[] = [];
    for (const [key] of sorted) {
      const [r, g, b] = key.split(",").map(Number);
      const rgb = { r, g, b };
      if (
        chosen.every((x) => deltaE(rgbToLab(x), rgbToLab(rgb)) > 12)
      ) {
        chosen.push(rgb);
        if (chosen.length === 5) break;
      }
    }
    setDominants(chosen);
  };

  const exportPdf = () => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 15;
    let y = 15;
    const ensure = (needed: number) => {
      if (y + needed > pageH - margin) {
        doc.addPage();
        y = margin;
      }
    };

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Tamiya Farbliste", margin, y + 2);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(100);
    doc.text(
      `Erstellt am ${new Date().toLocaleDateString("de-DE")} · ${entries.length} Farben`,
      margin,
      y,
    );
    y += 6;
    doc.setDrawColor(220);
    doc.line(margin, y, pageW - margin, y);
    y += 7;

    entries.forEach((entry, idx) => {
      const rows = entry.matches.length;
      const needed = 28 + rows * 8 + (entry.mix ? 15 : 0);
      ensure(needed);

      doc.setFillColor(entry.rgb.r, entry.rgb.g, entry.rgb.b);
      doc.setDrawColor(160);
      doc.roundedRect(margin, y, 18, 15, 1.5, 1.5, "FD");
      doc.setTextColor(20);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(`${idx + 1}. ${entry.name || `Farbe ${idx + 1}`}`, margin + 23, y + 5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(90);
      doc.text(
        `${entry.hex} · RGB ${entry.rgb.r}, ${entry.rgb.g}, ${entry.rgb.b}`,
        margin + 23,
        y + 11,
      );
      y += 21;

      doc.setFont("helvetica", "bold");
      doc.setTextColor(30);
      doc.setFontSize(9.5);
      doc.text("Beste Tamiya-Treffer", margin, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      entry.matches.forEach((m, mi) => {
        ensure(8);
        const crgb = hexToRgb(m.color.hex);
        doc.setFillColor(crgb.r, crgb.g, crgb.b);
        doc.rect(margin, y - 3.5, 6, 5, "F");
        doc.setTextColor(45);
        doc.text(
          `${mi + 1}. ${m.color.code} – ${m.color.name} · ${seriesName(m.color.code)} · ΔE ${m.distance.toFixed(1)}`,
          margin + 9,
          y,
        );
        y += 7;
      });

      if (entry.mix) {
        y += 1;
        doc.setFont("helvetica", "bold");
        doc.text("Mischvorschlag", margin, y);
        y += 5;
        doc.setFont("helvetica", "normal");
        doc.text(
          `${entry.mix.aPct}% ${entry.mix.a.code} + ${entry.mix.bPct}% ${entry.mix.b.code} · geschätztes ΔE ${entry.mix.distance.toFixed(1)}`,
          margin,
          y,
        );
        y += 5;
        doc.setFontSize(8);
        doc.setTextColor(110);
        doc.text(
          "Rechnerische Näherung; reale Pigmentmischungen können abweichen.",
          margin,
          y,
        );
        doc.setFontSize(9.5);
        y += 6;
      }

      doc.setDrawColor(230);
      doc.line(margin, y, pageW - margin, y);
      y += 7;
    });

    doc.save(`tamiya-farbliste-${Date.now()}.pdf`);
  };

  const overlayStyle = (() => {
    const img = imgRef.current;
    if (!selection || !img?.naturalWidth || !img?.naturalHeight) return undefined;
    return {
      left: `${(selection.x / img.naturalWidth) * 100}%`,
      top: `${(selection.y / img.naturalHeight) * 100}%`,
      width: `${(selection.w / img.naturalWidth) * 100}%`,
      height: `${(selection.h / img.naturalHeight) * 100}%`,
    };
  })();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-7">
          <h1 className="text-3xl font-bold tracking-tight">Tamiya Farbfinder Pro</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Foto hochladen, Farbe per Punkt oder Fläche messen, passende Tamiya-Töne finden,
            Mischvorschläge berechnen und die benannte Farbliste als PDF exportieren.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.45fr_.85fr]">
          <section className="rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-end gap-3">
              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
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
              <label className="text-xs text-muted-foreground">
                Messmodus
                <select
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value as "point" | "area");
                    setSelection(null);
                  }}
                  className="mt-1 block rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
                >
                  <option value="point">Punkt / Mittelwert</option>
                  <option value="area">Fläche markieren</option>
                </select>
              </label>
              {mode === "point" && (
                <label className="text-xs text-muted-foreground">
                  Mittelwert
                  <select
                    value={sampleRadius}
                    onChange={(e) => setSampleRadius(Number(e.target.value))}
                    className="mt-1 block rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
                  >
                    <option value={0}>1 Pixel</option>
                    <option value={2}>5×5</option>
                    <option value={4}>9×9</option>
                    <option value={7}>15×15</option>
                    <option value={12}>25×25</option>
                  </select>
                </label>
              )}
              {mode === "area" && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={robustArea}
                    onChange={(e) => setRobustArea(e.target.checked)}
                  />
                  Schatten/Reflexe filtern
                </label>
              )}
            </div>

            {imageUrl ? (
              <div className="mt-5">
                <div className="relative inline-block max-w-full select-none">
                  <img
                    ref={imgRef}
                    src={imageUrl}
                    alt="Hochgeladenes Bild"
                    draggable={false}
                    onClick={onClick}
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onMouseLeave={() => {
                      if (dragStart) onMouseUp();
                    }}
                    className="max-h-[620px] max-w-full cursor-crosshair rounded-md border border-border object-contain"
                    onLoad={() => {
                      canvasRef.current = null;
                    }}
                  />
                  {selection && mode === "area" && overlayStyle && (
                    <div
                      className="pointer-events-none absolute border-2 border-dashed border-white bg-white/10 shadow-[0_0_0_1px_rgba(0,0,0,.6)]"
                      style={overlayStyle}
                    />
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {mode === "point"
                    ? "Klicke auf eine Bildstelle. Der gewählte Pixelbereich wird gemittelt und automatisch zur Farbliste hinzugefügt."
                    : "Ziehe mit gedrückter Maustaste ein Rechteck über eine möglichst homogene Fläche."}
                </p>
              </div>
            ) : (
              <div className="mt-5 flex min-h-72 items-center justify-center rounded-md border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
                Noch kein Bild geladen
              </div>
            )}

            {imageUrl && (
              <div className="mt-6 border-t border-border pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">Dominante Bildfarben</h2>
                    <p className="text-xs text-muted-foreground">5 häufige, farblich voneinander getrennte Bildtöne.</p>
                  </div>
                  <button
                    onClick={analyzeDominants}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    5 dominante Farben erkennen
                  </button>
                </div>
                {dominants.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {dominants.map((rgb, i) => (
                      <button
                        key={`${rgbToHex(rgb)}-${i}`}
                        onClick={() => addEntry(rgb, `Dominante Farbe ${i + 1}`)}
                        className="group text-left"
                        title="Zur Farbliste hinzufügen"
                      >
                        <div
                          className="h-14 w-20 rounded-md border border-border transition group-hover:scale-105"
                          style={{ backgroundColor: rgbToHex(rgb) }}
                        />
                        <div className="mt-1 font-mono text-[10px] text-muted-foreground">{rgbToHex(rgb)}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-semibold">Abgleich-Einstellungen</h2>
            <div className="mt-4 space-y-4">
              <div>
                <div className="mb-2 text-xs text-muted-foreground">Tamiya-Serien</div>
                <div className="flex flex-wrap gap-2">
                  {(["X", "XF", "LP", "TS"] as Series[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => toggleSeries(s)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        activeSeries.includes(s)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-muted-foreground"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block text-xs text-muted-foreground">
                Treffer pro Farbe
                <select
                  value={matchCount}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setMatchCount(n);
                    recalcEntries(activeSeries, n);
                  }}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
                >
                  {[3, 5, 8, 10].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <div className="rounded-md bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
                Die Tamiya-HEX-Werte sind digitale Näherungswerte. Beleuchtung, Kamera, Weißabgleich, Glanz und reale Pigmente können das Ergebnis verändern.
              </div>
              {status && <div className="text-xs text-destructive">{status}</div>}
            </div>
          </aside>
        </div>

        {entries.length > 0 && (
          <section className="mt-7">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Farbliste ({entries.length})</h2>
                <p className="text-xs text-muted-foreground">Namen können direkt geändert werden und erscheinen so im PDF.</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEntries([])}
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

            <div className="grid gap-4">
              {entries.map((entry) => (
                <article key={entry.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="h-16 w-16 shrink-0 rounded-md border border-border" style={{ backgroundColor: entry.hex }} />
                    <div className="min-w-0 flex-1">
                      <input
                        value={entry.name}
                        onChange={(e) => updateEntryName(entry.id, e.target.value)}
                        className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm font-semibold"
                      />
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {entry.hex} · RGB {entry.rgb.r}, {entry.rgb.g}, {entry.rgb.b}
                      </div>
                    </div>
                    <button
                      onClick={() => removeEntry(entry.id)}
                      className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                    >
                      Entfernen
                    </button>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    {entry.matches.map((m) => (
                      <div key={m.color.code} className="flex items-center gap-2 rounded-md border border-border p-2">
                        <div className="h-9 w-9 shrink-0 rounded border border-border" style={{ backgroundColor: m.color.hex }} />
                        <div className="min-w-0 text-xs">
                          <div className="truncate font-semibold">{m.color.code} – {m.color.name}</div>
                          <div className="text-muted-foreground">{seriesName(m.color.code)}</div>
                          <div className="font-mono text-muted-foreground">ΔE {m.distance.toFixed(1)}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {entry.mix && (
                    <div className="mt-3 rounded-md border border-border bg-muted/20 p-3 text-sm">
                      <div className="font-semibold">Rechnerischer Mischvorschlag</div>
                      <div className="mt-1">
                        {entry.mix.aPct}% <strong>{entry.mix.a.code}</strong> + {entry.mix.bPct}% <strong>{entry.mix.b.code}</strong>
                        <span className="ml-2 text-xs text-muted-foreground">geschätztes ΔE {entry.mix.distance.toFixed(1)}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">Reale Pigmentmischungen können von der rechnerischen RGB-Näherung abweichen.</div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
