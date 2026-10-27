import React from "react";
import { createRoot } from "react-dom/client";
import { AuthGate } from "./Auth.jsx";
const App = React.lazy(() => import("./App.jsx").then(module => ({default:module.App})));
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./styles.css";
import "./responsive.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthGate><React.Suspense fallback={<div className="workspace-loading">Opening your private desk…</div>}><App /></React.Suspense></AuthGate>
  </React.StrictMode>,
);
