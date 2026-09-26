import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import FicharApp from "./FicharApp";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FicharApp />
  </React.StrictMode>,
);
