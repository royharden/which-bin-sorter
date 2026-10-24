import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Browser build only. The Deno edge function under supabase/functions is never bundled here.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
