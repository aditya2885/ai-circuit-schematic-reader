import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In development, /api is proxied to the Python server (SR_API_PROXY, default http://127.0.0.1:8000),
// so the app and the API share one origin. Set VITE_API_URL to call a server elsewhere instead.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: { "/api": { target: env.SR_API_PROXY || "http://127.0.0.1:8000", changeOrigin: true } },
    },
  };
});
