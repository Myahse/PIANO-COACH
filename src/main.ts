import { mountApp } from "./ui/app";
import "./styles/app.css";

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) throw new Error("Missing #app");
try {
  mountApp(root);
} catch (error) {
  const message = error instanceof Error ? error.message : "Could not start Piano Coach.";
  root.innerHTML = `<div class="app"><p class="error">Startup failed: ${message}</p></div>`;
  console.error(error);
}
