import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Link, Route, Routes } from "react-router-dom";
import { Projects } from "./pages/Projects";
import { ProjectDetail } from "./pages/ProjectDetail";
import { PipelineBoard } from "./pages/PipelineBoard";
import { Providers } from "./pages/Providers";
import "./styles.css";

function App() {
  return (
    <HashRouter>
      <div className="topbar">
        <span className="logo">📦 自媒体内容工作台</span>
        <Link to="/">项目</Link>
        <Link to="/providers">引擎管理</Link>
      </div>
      <Routes>
        <Route path="/" element={<Projects />} />
        <Route path="/project/:id" element={<ProjectDetail />} />
        <Route path="/pipeline/:id" element={<PipelineBoard />} />
        <Route path="/providers" element={<Providers />} />
      </Routes>
    </HashRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
