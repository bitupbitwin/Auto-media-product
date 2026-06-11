import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, connectWs, STATUS_LABEL } from "../api";

export function PipelineBoard() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [streams, setStreams] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(() => {
    api.get<any>(`/api/pipelines/${id}`).then(setData).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    load();
    api.get<any[]>("/api/providers").then(setProviders).catch(() => undefined);
    timer.current = setInterval(load, 2500);
    const close = connectWs((event) => {
      if (String(event.pipelineId) !== String(id)) return;
      if (event.type === "step-stream") {
        setStreams((prev) => ({
          ...prev,
          [event.stepId]: ((prev[event.stepId] ?? "") + event.data.chunk).slice(-4000),
        }));
      } else {
        load();
      }
    });
    return () => {
      clearInterval(timer.current);
      close();
    };
  }, [id, load]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      setError("");
      await fn();
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!data) return <div className="page">{error || "加载中…"}</div>;

  const textProviders = providers.filter((p) => p.enabled && (p.kind === "cli" || p.kind === "api-text" || p.kind === "web"));
  const imageProviders = providers.filter((p) => p.enabled && p.kind === "api-image");

  return (
    <div className="page">
      <p className="muted">
        <Link to={`/project/${data.project_id}`}>← 返回项目</Link>
      </p>
      <div className="row" style={{ justifyContent: "space-between", margin: "10px 0 16px" }}>
        <h2>
          {data.name} <span className={`badge ${data.status}`}>{STATUS_LABEL[data.status] ?? data.status}</span>
        </h2>
        <div className="row">
          <a href={`/api/pipelines/${id}/export`} download>
            <button className="ghost">📦 导出产物包</button>
          </a>
          <button onClick={() => act(() => api.post(`/api/pipelines/${id}/run`))}>▶ 运行流程</button>
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}

      {data.steps.map((step: any) => (
        <StepCard
          key={step.id}
          step={step}
          stream={streams[step.id]}
          reviews={data.reviews.filter((r: any) => r.step_id === step.id)}
          providerOptions={step.type === "cover" ? imageProviders : textProviders}
          onSetProvider={(pid) => act(() => api.post(`/api/steps/${step.id}/provider`, { providerId: pid }))}
          onRerun={() => act(() => api.post(`/api/steps/${step.id}/rerun`))}
          onSelect={(aid) => act(() => api.post(`/api/artifacts/${aid}/select`))}
          onConfirm={() => act(() => api.post(`/api/steps/${step.id}/confirm`))}
          onRegenerate={(target, feedback) => {
            const targetStep = data.steps.find((s: any) => s.type === target);
            if (targetStep) act(() => api.post(`/api/steps/${targetStep.id}/rerun`, { feedback }));
          }}
        />
      ))}

      {data.notes?.length > 0 && (
        <div className="card">
          <h3>📋 发布注意事项（手动发布前逐条核对）</h3>
          <ul className="notes">
            {data.notes.map((note: string, i: number) => (
              <li key={i}>
                <label style={{ display: "inline", color: "inherit" }}>
                  <input type="checkbox" style={{ width: "auto", marginRight: 8 }} />
                  {note}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StepCard(props: {
  step: any;
  stream?: string;
  reviews: any[];
  providerOptions: any[];
  onSetProvider: (pid: string) => void;
  onRerun: () => void;
  onSelect: (aid: number) => void;
  onConfirm: () => void;
  onRegenerate: (target: string, feedback: string) => void;
}) {
  const { step, stream, reviews, providerOptions } = props;
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <div className={`step-card ${step.status}`} style={{ marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <h3>{step.name}</h3>
          <span className={`badge ${step.status}`}>{STATUS_LABEL[step.status] ?? step.status}</span>
          {step.needs.length > 0 && <span className="muted">依赖：{step.needs.join("、")}</span>}
        </div>
        <div className="row">
          <select
            style={{ width: 240 }}
            value={step.provider_id ?? ""}
            onChange={(e) => props.onSetProvider(e.target.value)}
          >
            <option value="" disabled>
              选择引擎…
            </option>
            {providerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="ghost small" onClick={props.onRerun} disabled={step.status === "running"}>
            {step.status === "pending" ? "等待依赖/运行" : "重跑"}
          </button>
          {step.prompt_rendered && (
            <button className="ghost small" onClick={() => setShowPrompt(!showPrompt)}>
              Prompt
            </button>
          )}
        </div>
      </div>

      {showPrompt && <div className="artifact">{step.prompt_rendered}</div>}
      {step.error && <div className="error-text">❌ {step.error}</div>}
      {stream && step.status === "running" && <div className="stream">{stream}</div>}

      {step.status === "waiting_human" && (
        <p style={{ marginTop: 10, color: "var(--yellow)" }}>
          ⏸ 请在下方候选中点选一个，然后点击「确认选择，继续流程」
        </p>
      )}

      <Artifacts step={step} onSelect={props.onSelect} />

      {step.status === "waiting_human" && (
        <div style={{ marginTop: 10 }}>
          <button onClick={props.onConfirm} disabled={!step.artifacts.some((a: any) => a.selected)}>
            确认选择，继续流程
          </button>
        </div>
      )}

      {reviews.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {reviews.map((review) => (
            <div className="artifact" key={review.id}>
              <strong>
                {review.target === "title" ? "标题" : review.target === "content" ? "内容" : review.target}评审
                {review.provider_id === "rule:keywords" ? "（规则预检）" : ""}：
                <span className={`badge ${review.verdict === "pass" ? "succeeded" : "failed"}`} style={{ marginLeft: 6 }}>
                  {review.verdict} {review.total ? `${review.total}分` : ""}
                </span>
              </strong>
              {Object.keys(review.scores).length > 0 && (
                <div className="score-bar">
                  {Object.entries(review.scores).map(([k, v]) => (
                    <span className="score-item" key={k}>
                      {k}: {String(v)}
                    </span>
                  ))}
                </div>
              )}
              {review.issues.map((issue: string, i: number) => (
                <p key={i} style={{ color: "var(--red)" }}>
                  ⚠ {issue}
                </p>
              ))}
              {review.suggestions.map((s: string, i: number) => (
                <p key={i} style={{ color: "var(--green)" }}>
                  💡 {s}
                </p>
              ))}
              {["title", "content", "cover"].includes(review.target) &&
                (review.issues.length > 0 || review.suggestions.length > 0) && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      className="ghost small"
                      onClick={() =>
                        props.onRegenerate(
                          review.target,
                          [...review.issues.map((x: string) => `问题：${x}`), ...review.suggestions.map((x: string) => `建议：${x}`)].join("\n")
                        )
                      }
                    >
                      🔄 按建议重新生成{review.target === "title" ? "标题" : review.target === "content" ? "内容" : "封面"}
                    </button>
                  </div>
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Artifacts({ step, onSelect }: { step: any; onSelect: (aid: number) => void }) {
  const artifacts: any[] = step.artifacts ?? [];
  if (artifacts.length === 0) return null;
  const latestVersion = Math.max(...artifacts.map((a) => a.version));
  const visible = artifacts.filter((a) => a.version === latestVersion);

  return (
    <div style={{ marginTop: 6 }}>
      <p className="muted" style={{ marginTop: 8 }}>
        产物（v{latestVersion}，点击文本/图片可设为选中）：
      </p>
      <div className={step.type === "cover" ? "grid" : ""}>
        {visible.map((a) => (
          <div
            key={a.id}
            className={`artifact ${a.selected ? "selected" : ""}`}
            style={{ cursor: "pointer" }}
            onClick={() => onSelect(a.id)}
            title={a.selected ? "当前选中" : "点击选中"}
          >
            {a.label && <p className="muted">{a.label} {a.selected ? "✓ 已选" : ""}</p>}
            {!a.label && a.selected && <p className="muted">✓ 已选</p>}
            {a.kind === "image" && a.file_path && <img src={`/api/artifacts/${a.id}/file`} alt={a.label ?? ""} />}
            {a.kind === "text" && a.content}
            {a.kind === "file" && <span>📁 {a.file_path}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
