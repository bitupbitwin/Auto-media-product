#!/usr/bin/env node
/**
 * 演示用本地 Mock LLM：读取提示词文件，根据提示词中的输出要求返回固定格式的演示内容。
 * 用途：让用户在未配置任何真实 CLI / API 引擎时也能完整跑通流程。
 * 用法：node mock-llm.mjs <prompt_file>
 */
import fs from "node:fs";

const promptFile = process.argv[2];
const prompt = promptFile ? fs.readFileSync(promptFile, "utf-8") : "";

const topicMatch = prompt.match(/主题[^:：\n]*[:：]\s*(.+)/);
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
} else if (prompt.includes("@[TOC]") || prompt.includes("CSDN")) {
  console.log(
    [
      `@[TOC](${topic} 实战详解)`,
      "",
      `# ${topic} 实战详解`,
      "",
      `工作中遇到「${topic}」相关问题，记不住、搞不清？本文带你从原理到实战一次讲透。`,
      "",
      "## 一、核心概念",
      "",
      `先理解「${topic}」要解决的问题：它的本质是在保证正确性的前提下提升效率。`,
      "",
      "## 二、快速上手",
      "",
      "```bash",
      "# 演示命令（注释用中文，便于理解）",
      "echo '第一步：初始化环境'",
      "echo '第二步：执行核心逻辑'",
      "```",
      "",
      "## 三、流程图解",
      "",
      "```mermaid",
      "graph LR",
      "A[输入] --> B[处理] --> C[输出]",
      "```",
      "",
      "## 四、关键公式",
      "",
      "当数据规模为 $n$ 时，时间复杂度约为 $O(n \\log n)$。",
      "",
      "## 总结",
      "",
      "本文梳理了核心概念、上手步骤与注意事项，建议收藏备用。",
      "",
      "> **🔥 原创不易，如有收获请点个赞！**",
      ">",
      "> **👨‍💻 关注我，带你深入浅出学技术！**",
      ">",
      "> **💬 遇到问题？欢迎在评论区留言交流！**",
      "",
      "【摘要】",
      `本文围绕「${topic}」展开，从核心概念、快速上手、流程图解到关键公式逐层讲解，配有示例代码与实战建议，适合有一定基础的开发者收藏查阅。`,
      "",
      "【标签】",
      `${topic}, 实战教程, 后端开发`,
    ].join("\n")
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
