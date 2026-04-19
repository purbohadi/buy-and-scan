import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const googleSiteVerification = env.VITE_GOOGLE_SITE_VERIFICATION ?? "";

  return {
    plugins: [
      react(),
      {
        name: "inject-google-site-verification",
        transformIndexHtml(html) {
          if (!googleSiteVerification.trim()) return html;
          if (html.includes("google-site-verification")) return html;
          const content = googleSiteVerification.replace(/"/g, "&quot;");
          return html.replace(
            "</head>",
            `  <meta name="google-site-verification" content="${content}" />\n  </head>`
          );
        }
      },
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.svg"],
        manifest: {
          name: "Scan & Parse",
          short_name: "ScanParse",
          description: "Capture receipts, parse with AI, review, and sync to your sheet.",
          theme_color: "#0f172a",
          background_color: "#0f172a",
          display: "standalone",
          start_url: "/",
          icons: [
            {
              src: "favicon.svg",
              sizes: "64x64",
              type: "image/svg+xml",
              purpose: "any"
            }
          ]
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webp}"],
          navigateFallbackDenylist: [/^\/api\//]
        }
      })
    ],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8787",
          changeOrigin: true
        },
        "/privacy": {
          target: "http://127.0.0.1:8787",
          changeOrigin: true
        },
        "/terms": {
          target: "http://127.0.0.1:8787",
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: "dist"
    }
  };
});
