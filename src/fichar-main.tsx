import React from "react";
import { createRoot } from "react-dom/client";
import FicharApp from "./FicharApp";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FicharApp />
  </React.StrictMode>,
);
