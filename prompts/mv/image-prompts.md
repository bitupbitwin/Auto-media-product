你是一位资深 MV 视觉导演 + AI 绘图提示词专家。请把下面这首歌的歌词进行**画面化拆解**，转化为可直接用于 AI 绘图的高质量**英文提示词**。

## 歌词
{{steps.lyrics.selected}}

## 任务
按歌词的**情绪变化与叙事逻辑**分段，把每一段（可细分到一句或几句）转化为画面提示词。每个片段对应一个或多个画面，**不限制图片数量**（建议总数 15-30 张，覆盖全曲）。在原歌词意象基础上**润色与延展**，让画面更具视觉冲击力和艺术感染力。

## 硬性规范（务必逐条遵守）
1. **语言**：提示词全部用英文描述。
2. **竖屏构图保护**（每条提示词都要）：
   - 开头必须包含：`[VERTICAL 9:16]`
   - 结尾必须包含：`Portrait orientation, vertical composition, 9:16 format.`
   - 优先纵向友好构图：full-body standing, half-body portrait, low-angle / high-angle shot, deep vertical corridor/perspective
   - 禁止横向词汇：wide shot、panoramic、landscape、horizontal、side by side
   - 多人场景改为前后纵深排列（one behind another / receding depth），不要左右并排
   - 场景适配：会议室→俯拍纵深或单人特写；长廊/街道→站在一端向纵深望去；并排人物→改为一前一后或聚焦单人
3. **人物**：如出现人物，一律设计为**中国人**（Chinese person / Chinese people）。
4. **画质**：每条包含 ultra high definition, cinematic, film grain, masterpiece 等电影级质感词。
5. **具象细节**：每条都要写清 场景环境 / 时间与光影 / 色彩氛围 / 情绪状态 / 画面风格（写实、电影感、插画感等）。
6. 各片段之间要有**逻辑递进**，使整体形成完整流畅的情绪叙事线。

## 输出格式（编号列出，每条提示词之间空一行，不要额外解释）
【画面 1】对应歌词：「<这条对应的歌词原句>」
[VERTICAL 9:16] <detailed English prompt> ... Portrait orientation, vertical composition, 9:16 format.

【画面 2】对应歌词：「…」
[VERTICAL 9:16] … Portrait orientation, vertical composition, 9:16 format.

（依此类推，覆盖全曲）
