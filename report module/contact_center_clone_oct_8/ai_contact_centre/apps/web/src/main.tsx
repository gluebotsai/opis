import ReactDOM from "react-dom/client";

import "@fontsource-variable/inter";
import App from "@/app/App";
import "./index.css";

// if (import.meta.env.DEV) {
//   void import("@locator/runtime").then((locator) => {
//     locator.default();
//   });
// }

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(<App />);
