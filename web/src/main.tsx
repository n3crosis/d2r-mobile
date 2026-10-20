import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Runtime initialization seals the document once; do not replay it in StrictMode.
createRoot(document.getElementById("root")!).render(<App />);
