import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./tailwind.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Collapse static preboot copy after React mounts; keep links in DOM for crawlers (OAuth verification).
queueMicrotask(() => {
  document.body.classList.add("app-ready");
  // The collapsed verification copy stays in the document, outside keyboard navigation.
  document.getElementById("preboot-home")?.setAttribute("inert", "");
});
