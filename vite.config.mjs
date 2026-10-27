import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { marketFeeds } from './server/vite-feeds.mjs';

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    fs: {deny: [".env", ".env.*", "**/.git/**", "**/.data/**", "**/.cache/**", "**/server/**"]},
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [marketFeeds(), react()],
});
