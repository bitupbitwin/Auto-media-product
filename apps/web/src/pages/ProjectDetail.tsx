import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, STATUS_LABEL } from "../api";

export function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");

  const load = () => {
    api.get<any>(`/api/projects/${id}`).then(setProject).catch((e) => setError(e.message));
    api.get<any[]>("/api/templates").then(setTemplates).catch(() => undefined);
  };
  useEffect(load, [id]);

  const toggle = (tid: string) =>
    setSelected((prev) => (prev.includes(tid) ? prev.filter((x) => x !== tid) : [...prev, tid]));

  const createPipelines = async (autoRun: boolean) => {
    try {
      setError("");
      let firstId: number | null = null;
      for (const templateId of selected) {
        const pipeline = await api.post<any>(`/api/projects/${id}/pipelines`, { templateId });
        if (firstId == null) firstId = pipeline.id;
        if (autoRun) await api.post(`/api/pipelines/${pipeline.id}/run`, { auto: true });
      }
      setSelected([]);
      if (selected.length === 1 && firstId != null) navigate(`/pipeline/${firstId}`);
      else load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!project) return <div className="page">{error || "加载中…"}</div>;

  return (
    <div className="page">
      <p className="muted">
        <Link to="/">← 返回项目列表</Link>
      </p>
      <h2 style={{ margin: "10px 0" }}>{project.title}</h2>
      <div className="card">
        <p>主题：{project.brief.topic}</p>
        {project.brief.audience && <p className="muted">人群：{project.brief.audience}</p>}
        {project.brief.sellingPoints && <p className="muted">卖点：{project.brief.sellingPoints}</p>}
      </div>

      <div className="card">
        <h3>选择平台流程（可多选，一稿多平台并行生成）</h3>
        <div className="row" style={{ marginTop: 10 }}>
          {templates.map((t) => (
            <button
              key={t.id}
              className={selected.includes(t.id) ? "" : "ghost"}
              onClick={() => toggle(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="ghost" disabled={selected.length === 0} onClick={() => createPipelines(false)}>
            创建 {selected.length || ""} 条流程
          </button>
          <button
            disabled={selected.length === 0}
            title="创建后立即全自动并行生成：标题自动选优、评审不过自动重生成"
            onClick={() => createPipelines(true)}
          >
            ⚡ 创建并全自动生成
          </button>
        </div>
        {error && <div className="error-text">{error}</div>}
      </div>

      <h3 style={{ margin: "16px 0 10px" }}>已创建的流程</h3>
      <div className="grid">
        {(project.pipelines ?? []).map((p: any) => (
          <Link to={`/pipeline/${p.id}`} key={p.id}>
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3>{p.name}</h3>
                <span className={`badge ${p.status}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
              </div>
              <p className="muted" style={{ marginTop: 6 }}>
                {p.created_at}
              </p>
            </div>
          </Link>
        ))}
        {(project.pipelines ?? []).length === 0 && <p className="muted">尚未创建流程。</p>}
      </div>
    </div>
  );
}
