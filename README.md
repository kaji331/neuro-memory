<div align="center">

# 🧠 neuro-memory

**让 AI 拥有"记忆"——跨智能体的持久记忆技能**

[![中文](https://img.shields.io/badge/语言-中文-red.svg)](README.md)
[![English](https://img.shields.io/badge/Language-English-blue.svg)](README.en.md)
[![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.x-f9f1cc?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-318%20passing-brightgreen)](#-马上来跑测试吧)

</div>

---

> ✨ **你是否也有过这样的困惑**：和 AI 聊过的东西，下次它全忘了。昨天刚讨论的方案，今天换了个窗口，它一脸茫然。你不得不一遍遍地重复自己讲过的话……
>
> **如果 AI 能记住你是谁、你关心什么、你们之前聊过什么，会怎样？**

**neuro-memory 就是答案。** 它是一个跨智能体（opencode / Pi / Claude Code / Crush）的持久记忆技能——自动记录每一次对话的知识，并在每次回应前自动召回相关记忆。**你的 AI，从此拥有了"记忆"。**

🛠️ 基于 **Bun + TypeScript + SQLite** 构建，采用 **LLM 驱动**的分类与相关度打分，**完全不需要向量嵌入**。

---

## 📖 目录

- [为什么你需要它](#-为什么你需要它)
- [它做了什么](#-它做了什么)
- [五分钟上手](#-五分钟上手)
- [接入你的智能体](#-接入你的智能体opencode--pi--claude-code--crush)
- [一个命令搞定更新](#-一个命令搞定更新bunx)
- [和 AI 对话时怎么用](#-和-ai-对话时怎么用)
- [配置详解](#-配置详解)
- [CLI 命令全览](#-cli-命令全览)
- [背后的原理](#-背后的原理)
- [项目结构](#-项目结构)
- [数据库支持](#-数据库支持)
- [马上来跑测试吧](#-马上来跑测试吧)
- [Roadmap](#-roadmap)
- [License](#-license)

---

## 💡 为什么你需要它

你大概已经发现：**大语言模型很聪明，但也很"健忘"。**

- 它没有长期的个人记忆——每次会话都是从零开始；
- 对话一旦结束或换个窗口，之前的信息就"蒸发"了；
- 你反复解释同一个背景，既浪费 token 又浪费耐心。

**neuro-memory 就像给 AI 装上了一个"第二大脑"**：把有价值的对话知识沉淀下来，用遗忘曲线科学管理，在需要时精准召回。你要的，它都记得。

---

## 🎯 它做了什么

它在**每一轮对话**中都默默执行两个动作：

### 📥 回应之前 —— 自动召回（Retrieval）
在每次回应前，它会在记忆库中搜索与当前话题相关的过往记忆，注入到上下文里。**默认静默运行**——不打扰你，却在悄悄影响每一次回答。

### 📤 回应之后 —— 自动记录（Recording）
每次对话结束后，它在**后台**派一个子智能体，把这一轮的知识：
1. **总结**成 1~2 句；
2. **分类**进"类别 → 子类别"的三层体系（完全由 LLM 动态生成，无需预定义分类法）；
3. **打分**相关度（0.0 ~ 1.0）；
4. **存入**记忆库。

### 🧠 三大核心特性

| 特性 | 说明 |
| --- | --- |
| **三层智能分类** | 类别、子类别、记忆条目——全部由 LLM 动态生成，无需预定义分类法 |
| **艾宾浩斯遗忘曲线** | 记忆随时间自然衰减；越常被"强化"的记忆留存越久（默认半衰期 24 小时） |
| **5000 条硬上限** | 达到上限自动剪枝低相关度的旧记忆，保持记忆库永远"精炼" |

> 🎁 **彩蛋：静默模式（默认开启）**。记忆的召回与存储全程在"后台"运行——由 opencode 插件（`plugin/`）静默处理，AI 不会在回复里透露出它查了记忆，也不会发起任何可见的工具调用。体验无缝而自然。想让它"亮出来"给你看？把配置里的 `display` 改成 `true` 即可。

> 🔧 **Pi (π) 尽力而为方案**：Pi (oh-my-pi) **没有 turn-boundary hook**（无法检测每轮对话结束、无法在每轮开始前静默注入记忆上下文），因此 neuro-memory 在 Pi 上**不能做到 opencode 那样的全静默一体化体验**。但以下两种途径仍然有效：
>
> 1. **显式命令** `/neuro-memory` — Pi 读取 SKILL.md 后自动识别该命令，status/query/recent/categories/top/help 全部可用。这是用户主动触发的、设计上可见的操作。
> 2. **会话启动时注入记忆**（recipe）：Pi 支持 `--append-system-prompt <文件>` 标志，可以在启动会话前生成记忆摘要文件并注入系统提示词：
>
>    ```bash
>    # 生成上下文并启动 Pi
>    bun run src/cli.ts query --all --limit 5 > /tmp/neuro_memory_context.md
>    omp --append-system-prompt /tmp/neuro_memory_context.md
>    ```
>
>    这将最近的记忆摘要**静默注入**到系统提示词（不可见），但仅在会话开始时生效一次，**不会在每轮对话中动态更新**。
>
> > 💡 **推荐**：需要全静默体验时，使用 opencode。Pi 上 neuro-memory 的显式命令和启动注入方案足以覆盖多数场景。

---

## 🚀 五分钟上手

### 前置条件

- 🟢 [Bun](https://bun.sh) ≥ 1.x

### 克隆 & 安装

```bash
# 克隆仓库
git clone https://github.com/kaji331/neuro-memory.git
cd neuro-memory

# 安装依赖
bun install

# 跑一遍测试（318 个用例全部通过）
bun test
```

---

## 🔌 接入你的智能体（opencode / Pi / Claude Code / Crush）

> 这个技能被设计成**跨智能体通用**——同一个 `~/.agents/skills/neuro-memory` 分发给不同工具。

### opencode

把技能放进 opencode 的技能目录即可自动被发现：

```bash
ln -s "$(pwd)" ~/.agents/skills/neuro-memory
```

**它怎么运作**：opencode 启动时会扫描 `~/.agents/skills/*/SKILL.md`，并把匹配的技能注入系统提示词。自动的"每次回应前查记忆、回应后记记忆"则由 **opencode 插件**（`plugin/`）静默完成——SKILL.md 只负责用户主动敲入的 `/neuro-memory` 显式命令。

> 🔌 **启用静默插件（一次性）**：插件文件位于 `~/.agents/skills/neuro-memory/plugin/index.ts`（`neuro-memory update` 已自动同步）。opencode 不会自动扫描 skill 目录里的 plugin，需要手动注册一次。在 `opencode.json`（项目 `.opencode/opencode.json` 或全局 `~/.config/opencode/opencode.json`）的 `plugin` 数组加入，或建一个自动发现的插件文件：
>
> `.opencode/plugins/neuro-memory.ts`（项目）或 `~/.config/opencode/plugins/neuro-memory.ts`（全局），内容：
> ```ts
> export { neuroMemoryPlugin as default } from "~/.agents/skills/neuro-memory/plugin/index";
> ```
> 重启 opencode 后，自动召回与录入即静默生效（默认 `display:false` 完全静默；改 `neuro-memory.yaml` 的 `display:true` 可见）。

### Pi (π)

Pi 通过 `~/.pi/agent/skills/`（指向 `~/.agents/skills/` 的符号链接农场）发现技能：

```bash
ln -s ~/.agents/skills/neuro-memory ~/.pi/agent/skills/neuro-memory
```

> 已经链过了？验证一下：`ls -la ~/.pi/agent/skills/neuro-memory`

**它怎么运作**：Pi 读取 SKILL.md 后会识别 `/neuro-memory` 命令。自动的"每轮全静默"召回/记录依赖 opencode 插件机制（Pi 没有 turn-boundary hook），因此在 Pi 上只能通过显式命令或会话启动前注入记忆上下文（见上方 ⚠️ 说明）。推荐 opencode 来获得全静默体验。

### Claude Code

Claude Code 从 `~/.claude/skills/` 加载技能。它**不跟随符号链接**，所以需要复制一份：

```bash
cp -r ~/.agents/skills/neuro-memory ~/.claude/skills/neuro-memory
```

### Crush

Crush 从 `~/.config/crush/skills/`（同样是符号链接农场）加载：

```bash
mkdir -p ~/.config/crush/skills
ln -s ~/.agents/skills/neuro-memory ~/.config/crush/skills/neuro-memory
```

### ✅ 验证安装

```bash
ls -d ~/.agents/skills/neuro-memory 2>/dev/null && echo "✅ opencode"
ls -d ~/.pi/agent/skills/neuro-memory 2>/dev/null && echo "✅ Pi"
ls -d ~/.claude/skills/neuro-memory 2>/dev/null && echo "✅ Claude Code"
ls -d ~/.config/crush/skills/neuro-memory 2>/dev/null && echo "✅ Crush"
```

---

## ⚡ 一个命令搞定更新（bunx）

> 代码有更新？**一条 bunx 命令**就能把最新版本同步到 `~/.agents/skills`。

```bash
# 把最新技能同步到 ~/.agents/skills/neuro-memory（保留你的记忆数据库 data/）
bunx --bun -p "github:kaji331/neuro-memory" neuro-memory update

# 或者：先看效果，不真正写入（试运行）
bunx --bun -p "github:kaji331/neuro-memory" neuro-memory update --dry-run
```

支持的参数：

| 参数 | 作用 |
| --- | --- |
| `--dry-run` | 预演：只打印将要同步的内容，不真正写入 |
| `--force` | 跳过安全校验（当目标目录缺少 `data/` 时默认会拒绝覆盖） |
| `--target <path>` | 指定安装目标（默认 `~/.agents/skills/neuro-memory`） |

> 🛡️ **它是安全的**：只会同步 `SKILL.md`、配置、`src/`、`test/` 等源码，**永远不会覆盖 `data/` 里的记忆数据库**。

---

## 💬 和 AI 对话时怎么用

在聊天中，你可以直接敲入 `/neuro-memory` 来管理记忆（这些命令总会**打印**结果，是唯一显式的、按设计可见的命令；自动召回与记录由插件静默完成）：

| 命令 | 作用 |
| --- | --- |
| `/neuro-memory status` | 查看记忆库总览（总数、分类、相关度分布） |
| `/neuro-memory query <关键词>` | 按关键词搜索记忆 |
| `/neuro-memory recent` | 查看最近的记忆 |
| `/neuro-memory top` | 查看相关度最高的记忆 |
| `/neuro-memory categories` | 查看分类清单 |
| `/neuro-memory help` | 显示可用命令列表 |

遇到未知子命令（比如 `/neuro-memory delete`）？它会显示帮助列表，而**不会**去猜测执行一个不存在的命令。👍

---

## 🔧 配置详解

所有行为都通过 `neuro-memory.yaml` 配置，改完即生效（全都是默认值，按需修改）：

```yaml
# ── 静默模式（还记得开场那个"彩蛋"吗）──
display: false                 # false = 完全静默（默认，由插件静默召回/记录）；true = 打印召回的"历史记忆"

# ── 数据库 ──
db:
  type: sqlite                  # sqlite | postgres | duckdb | mysql | mariadb
  sqlite_path: "~/.agents/skills/neuro-memory/data/memory.db"
  # postgres_url: "postgres://user:pass@localhost:5432/neuro_memory"   # 仅 postgres 使用

# ── 记忆上限 ──
memory:
  max_entries: 5000                   # 记忆条数硬上限（100-100000）
  max_token_per_entry: 1024            # 每条记忆摘要的最大 token（256-4096）
  max_categories: 50                   # 顶层类别上限（10-500）
  max_subcategories_per_category: 100  # 每个类别下的子类别上限（10-500）
  max_subcategory_links: 3             # 一个子类别可关联的类别数（1-10，多对多）
  max_subcategory_per_memory: 10       # 一条记忆可归属的子类别数（1-20）

# ── 召回 ──
retrieval:
  relevance_threshold: 0.75     # 召回的最低相关度（0.0-1.0，越高越严格）
  max_results: 3                # 每次召回的条数（1-10）
  timeout_ms: 3000              # 召回超时（毫秒），超时就跳过注入

# ── 遗忘曲线（艾宾浩斯）──
ebbinghaus:
  half_life_hours: 24           # 半衰期：记忆相关度降到 50% 需要的时间（小时）
  min_relevance: 0.1            # 低于该相关度就在维护时自动删除
  reinforcement_boost: 0.15     # 每次"强化"（发现重复内容）的提升量
  prune_interval_hours: 1.0     # 自动清理的间隔（小时）

# ── 总结 / 分类 ──
summarization:
  model: ""                     # 留空则和主智能体用同一个模型
  prompt_template: ""           # 留空则用内置默认提示词
```

**配置加载顺序**：`--config <path>` 参数 → `$CLAUDE_SKILL_DIR/neuro-memory.yaml` → 当前目录 `./neuro-memory.yaml` → 以上默认值。

---

## 🧰 CLI 命令全览

> 你可以用 `bun run src/cli.ts <命令>` 调用，也可以直接使用安装后的 `neuro-memory` 命令。

### 🔍 query —— 搜索记忆

```bash
bun run src/cli.ts query --keyword "python"          # 按关键词
bun run src/cli.ts query --category "programming"    # 按类别
bun run src/cli.ts query --all --limit 20            # 全部（最近优先）
bun run src/cli.ts query --relevance 0.8 --limit 5   # 按相关度（top）
```

> 💡 **新增能力**：`--all` 会列出全部记忆并**按创建时间从新到旧**排序；不带任何筛选条件时默认就是 `--all`（相当于"最近记忆"）。

### ➕ insert —— 插入记忆

```bash
# 方式一：直接指定内容
bun run src/cli.ts insert \
  --content "TypeScript 是 JavaScript 的类型超集" \
  --summary "TypeScript 定义" \
  --category "programming" \
  --subcategory "languages" \
  --relevance 0.9

# 方式二：从 JSON 文件批量导入
bun run src/cli.ts insert --from-file memories.json

# 方式三：直接塞一段对话文本（占位实现，归入"Unclassified/General"）
bun run src/cli.ts insert --conversation-turn "<对话文本>"
```

> 🔁 **自动去重**：内容相同会触发"强化"，而不是重复插入（会打印 `Memory already exists. Reinforcement applied (+1).`）。

### 💪 reinforce —— 强化记忆

```bash
bun run src/cli.ts reinforce --id 42               # 按 ID
bun run src/cli.ts reinforce --content-hash <前缀>  # 按内容哈希
bun run src/cli.ts reinforce --all                 # 全部
```

### 🧹 prune —— 剪枝低相关度记忆

```bash
bun run src/cli.ts prune --dry-run   # 先看看要删哪些
bun run src/cli.ts prune --force     # 确认执行
```

### 📊 status —— 系统总览

```bash
bun run src/cli.ts status
```

### 🔄 maintenance —— 全量维护（重算相关度 → 剪枝 → 清理孤儿分类）

```bash
bun run src/cli.ts maintenance
bun run src/cli.ts maintenance --force
```

### ✅ validate —— 校验配置

```bash
bun run src/cli.ts validate
bun run src/cli.ts validate --show-defaults   # 打印默认配置
bun run src/cli.ts validate --file path/to/config.yaml
```

---

## 🧩 背后的原理

```
用户消息
    │
    ▼
┌─────────────────────────────────┐
│ opencode / Pi / Claude / Crush  │
│ （每一轮都读取 SKILL.md）         │
└─────────┬───────────────────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
  召回          记录
 (回应前)      (回应后)
    │           │
    │           ▼
    │    task(run_in_background=true)   ← 后台子智能体
    │    ┌──────────────────────────┐
    │    │ 总结 → 分类 → 打分 → 存储 │
    │    └──────────────────────────┘
    │
    ▼
┌──────────────────────┐
│  neuro-memory CLI    │
│  src/cli.ts          │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  DBAdapter           │
│  (SQLite / Postgres) │
│                      │
│  核心表：            │
│  categories          │
│  subcategories       │
│  memories            │
│                      │
│  + 艾宾浩斯遗忘曲线   │
│  + 5000 条上限       │
└──────────────────────┘
```

---

## 📂 项目结构

```
neuro-memory/
├── SKILL.md                    # 智能体集成说明（技能核心）
├── neuro-memory.yaml           # 配置文件
├── package.json                # Bun 项目
├── tsconfig.json               # TypeScript 配置
├── scripts/
│   └── neuro-memory-bin.ts     # bunx 安装/更新器
├── src/
│   ├── cli.ts                  # CLI 入口（v0.1.1）
│   ├── config.ts               # 配置解析与校验
│   ├── hash.ts                 # SHA-256 内容哈希 + 去重
│   ├── categories.ts           # 类别/子类别 CRUD
│   ├── memories.ts             # 记忆 CRUD + 上限强制
│   ├── ebbinghaus.ts           # 遗忘曲线与剪枝
│   ├── classifier.ts           # LLM 分类提示词与校验
│   ├── index.ts                # 模块入口
│   └── db/
│       ├── adapter.ts          # DBAdapter 接口 + 工厂
│       ├── sqlite-adapter.ts   # SQLite 实现（✅）
│       ├── postgres-adapter.ts # PostgreSQL 实现（✅）
│       ├── duckdb-adapter.ts   # 桩（⛔）
│       ├── mysql-adapter.ts    # 桩（⛔）
│       ├── mariadb-adapter.ts  # 桩（⛔）
│       ├── schema.ts           # 表定义
│       ├── init.ts             # 数据库初始化
│       ├── migrate.ts          # 迁移执行器
│       └── index.ts            # 聚合导出
├── test/                       # 12 个测试文件（318 用例）
└── data/
    └── memory.db               # SQLite 数据库（自动创建）
```

---

## 💾 数据库支持

| 后端 | 状态 | 说明 |
| --- | --- | --- |
| **SQLite** | ✅ 完整实现 | 基于 `bun:sqlite`，含遗忘曲线 SQL、`:memory:` 支持 |
| **PostgreSQL** | ✅ 完整实现 | 基于 `pg` 连接池、3 次重试；需单独安装 `pg` 依赖 |
| **DuckDB** | ⛔ 桩 | 抛出 "not implemented yet" |
| **MySQL** | ⛔ 桩 | 抛出 "not implemented yet" |
| **MariaDB** | ⛔ 桩 | 抛出 "not implemented yet" |

> 📌 **去中心化、可迁移**：核心是一个简洁的 `DBAdapter` 接口 + 工厂，接新数据库只是实现一个新适配器而已。

---

## 🧪 马上来跑测试吧

```bash
# 跑全部测试（318 个用例）
bun test

# 跑单个测试套件
bun test test/categories.test.ts
bun test test/ebbinghaus.test.ts

# TypeScript 类型检查（需先安装 tsc）
# bun run tsc --noEmit
```

目前共 **12 个测试文件、318 个用例**，覆盖分类、CLI、配置、哈希、记忆、遗忘曲线、调度器、数据库适配器与桩（含 PostgreSQL 套件）——我们对正确性相当较真 😄。

---

## 🧭 Roadmap

- [ ] 为没有技能系统的智能体提供通用包装脚本
- [ ] 记忆浏览器 CLI（TUI）
- [ ] DuckDB / MySQL / MariaDB 适配器（完整实现）
- [ ] 跨会话记忆共享（多用户）

---

## 📜 License

[MIT](LICENSE)

---

<div align="center">

**觉得有用？给本项目 ⭐ 一个 Star，让更多 AI 拥有记忆！**

[English Version](README.en.md) · [中文版](README.md)

</div>
