#!/usr/bin/env node
/**
 * 演示用本地 Mock LLM：读取提示词文件，根据提示词中的输出要求返回固定格式的演示内容。
 * 用途：让用户在未配置任何真实 CLI / API 引擎时也能完整跑通流程。
 * 用法：node mock-llm.mjs <prompt_file>
 */
import fs from "node:fs";

const promptFile = process.argv[2];
const prompt = promptFile ? fs.readFileSync(promptFile, "utf-8") : "";

const topicMatch = prompt.match(/主题[:：]\s*(.+)/);
const topic = (topicMatch?.[1] ?? "今日选题").trim().slice(0, 30);

if (prompt.includes("JSON 数组") && prompt.includes("候选标题")) {
  console.log(
    JSON.stringify(
      [
        `${topic}，看完这篇就够了`,
        `普通人也能上手的${topic}指南`,
        `我试了 30 天${topic}，结果出乎意料`,
        `关于${topic}，90%的人都做错了这一步`,
        `${topic}避坑清单，建议收藏`,
      ],
      null,
      2
    )
  );
} else if (prompt.includes("评分") && prompt.includes("verdict")) {
  // 含 FORCE_REVISE 标记时输出不通过结论（用于测试全自动评审重生成闭环）
  const forceRevise = prompt.includes("FORCE_REVISE");
  console.log(
    JSON.stringify(
      [
        {
          target: "title",
          scores: { hook: forceRevise ? 5 : 8, platform_fit: 8, clarity: 9, compliance: 10, seo: 7 },
          total: forceRevise ? 68 : 84,
          verdict: forceRevise ? "revise" : "pass",
          issues: forceRevise ? ["标题钩子不够强"] : [],
          suggestions: ["可在标题中加入更具体的数字增强可信度"],
        },
        {
          target: "content",
          scores: { hook: forceRevise ? 5 : 7, platform_fit: 8, clarity: 8, compliance: 10, seo: 7 },
          total: forceRevise ? 66 : 80,
          verdict: forceRevise ? "revise" : "pass",
          issues: ["开头铺垫略长，建议压缩到 1 句话内"],
          suggestions: ["第一段直接给结论，再展开细节"],
        },
      ],
      null,
      2
    )
  );
} else if (prompt.includes("分镜")) {
  console.log(
    JSON.stringify(
      {
        scenes: [
          { shot: 1, visual: "近景特写，主角面向镜头", line: `你还在为${topic}发愁吗？`, subtitle: `你还在为${topic}发愁吗？`, durationSec: 3 },
          { shot: 2, visual: "屏幕录制/产品展示", line: "今天用 3 步讲清楚核心方法。", subtitle: "3 步讲清楚", durationSec: 5 },
          { shot: 3, visual: "要点字卡逐条弹出", line: "第一步，找准切入点；第二步，搭好结构；第三步，持续迭代。", subtitle: "三个步骤", durationSec: 8 },
          { shot: 4, visual: "回到出镜口播", line: "关注我，下期讲实操案例。", subtitle: "关注不迷路", durationSec: 3 },
        ],
        bgmHint: "轻快节奏，副歌不抢人声",
      },
      null,
      2
    )
  );
} else {
  console.log(
    [
      `（演示内容）关于「${topic}」：`,
      "",
      "开头钩子：用一个反常识结论抓住注意力。",
      "",
      "主体部分分三段展开：第一段给出背景与痛点，让读者产生共鸣；",
      "第二段给出可落地的方法与步骤，每一步配一个具体例子；",
      "第三段总结要点，并给出下一步行动建议。",
      "",
      "结尾引导互动：你在这件事上踩过什么坑？评论区聊聊。",
    ].join("\n")
  );
}
