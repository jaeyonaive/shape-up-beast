import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

console.log("App started");

try {
  const root = document.getElementById("root");
  if (!root) throw new Error("#root element not found in index.html");
  createRoot(root).render(<App />);
} catch (error) {
  console.error("App failed to start:", error);
  // Last-resort fallback so the user never sees a pure blank screen
  document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#0e1117;color:#e2e8f0;font-family:monospace;padding:1rem;text-align:center">
      <p style="font-size:2rem;margin-bottom:0.5rem">⚠️</p>
      <p style="margin-bottom:1rem">Failed to start. Please reload.</p>
      <button onclick="location.reload()" style="padding:0.6rem 1.5rem;background:#22c55e;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:bold">Reload</button>
    </div>`;
}
