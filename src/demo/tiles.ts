import { MOCK_RESPONSES } from "../../supabase/functions/identify/mockResponses.ts";

export interface DemoTile { readonly fixture_id: string; readonly label: string; readonly glyph: string; readonly color: string; }
const GLYPHS = ["▱", "▱", "▣", "♧", "▰", "☕", "▥", "⚡", "◉", "◉", "◇", "◈", "☕", "▣▥", "≋", "⌁", "!", "▤", "?"];
const COLORS = ["#e8b997", "#eed7af", "#c3d7ae", "#bdd7ce", "#cbd0d4"];
export const DEMO_TILES: readonly DemoTile[] = Object.values(MOCK_RESPONSES).map((entry, index) => ({
  fixture_id: entry.fixture_id, label: entry.label, glyph: GLYPHS[index] ?? "◇", color: COLORS[index % COLORS.length] ?? "#c3d7ae",
}));

/** A labelled drawing, not a real photograph. The returned PNG traverses exactly the upload intake pipeline. */
export function drawDemoTile(tile: DemoTile): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const context = canvas.getContext("2d");
  if (context === null) return Promise.reject(new Error("Canvas is unavailable. Try typing an item instead."));
  context.fillStyle = tile.color;
  context.fillRect(0, 0, 640, 480);
  context.fillStyle = "#284b3c";
  context.textAlign = "center";
  context.font = "96px sans-serif";
  context.fillText(tile.glyph, 320, 210);
  context.font = "bold 24px sans-serif";
  context.fillText(tile.label, 320, 310, 580);
  context.font = "16px sans-serif";
  context.fillText("AUTHORED DEMO TILE · NOT A PHOTOGRAPH", 320, 408);
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob === null ? reject(new Error("Could not draw the sample. Try typing an item.")) : resolve(blob), "image/png",
  ));
}
