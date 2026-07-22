# Tamiya Farbfinder Pro – Upgrade

Neu in dieser Version:

- Punkt-/Mittelwertmessung: 1 Pixel, 5×5, 9×9, 15×15, 25×25
- Flächenmessung per Rechteckauswahl
- Optionaler Schatten-/Reflex-Filter bei Flächenmessungen (entfernt je 10 % der dunkelsten/hellsten Pixel)
- Frei benennbare Farblisteneinträge
- Serienfilter X / XF / LP / TS
- 3 / 5 / 8 / 10 Treffer pro Messung
- Erweiterte LP- und TS-Referenzpalette
- Automatische Erkennung von 5 dominanten Bildfarben
- Rechnerischer Zwei-Farben-Mischvorschlag
- Überarbeiteter PDF-Export mit Name, Messfarbe, Tamiya-Treffern, ΔE und Mischvorschlag

## Hinweis zur Farbdatenbank
Die HEX-Werte sind digitale Näherungswerte und keine offiziellen spektralen/Lab-Messwerte von Tamiya. Kamera, Weißabgleich, Licht, Monitor und reale Pigmente beeinflussen die Übereinstimmung.

## Geänderte Hauptdateien
- `src/routes/index.tsx`
- `src/lib/tamiya-colors.ts`

## Build-Hinweis
In der Ausführungsumgebung konnte `npm install` wegen eines Timeouts nicht vollständig abgeschlossen werden; deshalb konnte der Produktionsbuild hier nicht abschließend ausgeführt werden. Die Änderungen basieren auf der bestehenden Projektstruktur und den bereits verwendeten Abhängigkeiten (`jspdf` ist bereits im Projekt vorhanden).
