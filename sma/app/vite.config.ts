import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// envDir aponta pra ../ — o arquivo de credenciais vive em sma/.env
// (e sma/.env.local opcionalmente sobrescreve). Bun e Vite leem o mesmo.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: "..",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
