// Entry of both webviews; body[data-view] picks the dashboard or the sidebar panel.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { Dashboard } from "./Dashboard.jsx";
import { LimitsPanel } from "./LimitsPanel.jsx";
import { vscode } from "./ui.jsx";
import "./styles.css";

function App({ view }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    const onMessage = (e) => { if (e.data && e.data.type === "data") setData(e.data); };
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);
  if (!data) return null;
  return (
    <MotionConfig reducedMotion="user">
      {view === "limits" ? <LimitsPanel data={data} /> : <Dashboard data={data} />}
    </MotionConfig>
  );
}

createRoot(document.getElementById("root")).render(<App view={document.body.dataset.view} />);
