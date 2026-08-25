# Sitz-3D-Vorschau (experimentell)

Zeigt Workspace-Schnittteile auf einem **einfachen Autositz-Dummy**, leicht gebogen (Sitzschale / Lehne).

Kein Optitex: keine echte Vernähung, keine Stoffphysik — nur eine abnehmbare Vorschau.

## Ein / Aus

In `featureFlags.ts`:

```ts
export const SEAT_3D_PREVIEW_ENABLED = true  // false = Menü + Modal weg
```

## Komplett entfernen

1. Ordner `src/seat3d/` löschen  
2. In `src/App.tsx` die Seat3d-Imports/`Suspense`-Stelle entfernen  
3. In `src/components/Toolbar.tsx` den Block hinter `SEAT_3D_PREVIEW_ENABLED` entfernen  

Sonst keine Abhängigkeiten im Store oder in der Persistenz.