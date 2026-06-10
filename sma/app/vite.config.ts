import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// envDir aponta pra ../ — o arquivo de credenciais vive em sma/.env
// (e sma/.env.local opcionalmente sobrescreve). Bun e Vite leem o mesmo.
// O proxy /api → backend usa a mesma PORT do server (default 3000).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "..", "");
  const backendPort = Number(env.PORT ?? 3000);
  return {
    plugins: [react(), tailwindcss()],
    envDir: "..",
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
