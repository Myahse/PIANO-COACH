import { defineConfig } from "vite";
import { muscriptorApiPlugin } from "./scripts/vite-muscriptor-plugin.mjs";

export default defineConfig({
  plugins: [muscriptorApiPlugin()],
  clearScreen: false,
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  optimizeDeps: {},
});
