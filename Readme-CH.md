# <div align="center">MEMENTO</div>



<div align="center">
### # 🌟 MEMENTO V2Ray Config Editor 🚀


![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)
![Tech](https://img.shields.io/badge/tech-React%20%2B%20Tauri%20%2B%20Rust-yellow.svg)


**最强大、最好看、功能最全的 V2Ray 配置管理器**

**All-in-One • 无需额外下载 • xray-core 内置**

</div>

---

> ### ❤️ 献给
> *我把这个程序献给 A Who。虽然我已经失去她了，但她教会了我什么是爱。如果你愿意，可以加入我的 Telegram 频道，也许会觉得有点意思。*
>
> Telegram: **https://t.me/+NqWGD5-OGv1jOGU8** | Email: **Epodonios@gmail.com**

 ## ❤️ 捐赠

> 如果这个程序让你的生活轻松了一点，帮你连上了，你可以帮助我添加更多功能，或者为你制作类似的程序。

**USDT (TRC20):**
```
TWdqYu5H6emRHd6jFfkHjfG8Yg2285DFmT
```


**Tron:**
```
TWdqYu5H6emRHd6jFfkHjfG8Yg2285DFmT
```


**BTC (TRC20):**
```
TWdqYu5H6emRHd6jFfkHjfG8Yg2285DFmT
```

---
## 📖 关于 MEMENTO

**MEMENTO** 是一款现代化的 Windows 工具，用于管理、编辑和连接 V2Ray/Xray 配置。凭借 Glassmorphism 用户界面和流畅的动画，它提供了绕过网络审查的专业体验。

**MEMENTO** 是一款专为 Windows 打造的强大而优雅的 V2Ray 配置编辑器。它可以让你轻松导入、编辑、扫描和连接数千个配置。享受现代化的用户界面、伊朗模式（Domain Fronting）、实时流量统计、自动故障转移和 QR Code 分享。

 
## ✨ 功能一览

### 📥 导入 – 万能输入
- 从文本、剪贴板、`.txt` 文件、**订阅链接** 粘贴 (4个代理备用)
- 自动识别 Base64 订阅列表
- 去重检测
- 每源最多 **2000 个配置** – 防止界面卡死
- 可直接加入 **订阅分组**

### 📊 配置表 – MEMENTO 的核心
- 表格视图针对分屏优化 (窄窗口自动隐藏地址/状态)
- 搜索、过滤 (全部/有效/无效/协议)、按名称/协议/地址/端口/**延迟**排序
- 批量选择 – **全新交互:**
  - 点击 + 拖动选择范围
  - `Shift + Click` + 滚轮扩展选择
  - `Ctrl + C` 复制选中行
  - `Ctrl + V` 粘贴到当前分组
  - `Enter` 快速连接 VPN
- 内联 **延迟** 列，彩色徽章 (🟢 <100ms / 🟡 100-300ms / 🔴 >300ms)
- **⚡ Ping 按钮** – Rust 原生 TCP 批量 Ping (类似 v2rayN / nekoray) – 1-2秒测数百个
- **🔌 一键连接** 按钮
- 展开查看完整详情 (UUID, SNI, Host, Path, Flow...)
- **分享悬浮菜单:** Base64 复制 / 精美 QR 码弹窗
- **订阅分组标签页** + 🔄 刷新按钮
- **Brokers 按钮:** 精选仓库 (Epodonios, 0xRadikal, Argh94, Alirewa, iboxz, cbusifabcap)

### 🔐 VPN 连接 – 真正的桌面 VPN
- **无需手动安装 xray!** 5级查找优先级，若无则首次连接时自动从 GitHub 下载 (~15MB, 仅一次)
- 系统代理开关 (SOCKS5 + HTTP)
- 实时状态卡、运行时间、来自 xray-core 的真实日志、通过 `xray api statsquery` 的真实上传/下载流量
- **自动故障转移:** 连接断开时自动切换到最佳候选 (同组或全部，同端口选项)
- **Spoofing Patt 助手:** 以管理员身份运行捆绑的工具

### 🎨 编辑器 – 批量重写
- **IP 段模式:** 跨 CIDR (`104.16.0.0/24`) 克隆配置
- **伪装模式:** 新 IP/Host + 新端口 – 保留 UUID, TLS 等

### 📦 导出 – 高级多选过滤器 (新)
- 格式: Raw, Base64, JSON, Clash Meta, Surge, Sing-Box
- 订阅分组范围、传输/端口/协议/Ping 多选过滤器
- 实时计数器 `X / Y`

### 👁️ 自定义桌面 UI
- 自定义标题栏 (无装饰)，可拖动，主题化 Min/Max/Close
- 白色自定义光标，禁用右键菜单 (输入框除外)

---

## 🖼️ 截图

| 导入 | 配置表 | VPN 连接 |
|--------|--------------|----------------|
| ![Import](screenshots/import.png) | ![Configs](screenshots/configs.png) | ![Connection](screenshots/connection.png) |

---

## 🚀 安装与快速开始

### 最终用户
1. 从 [Releases](../../releases) 下载 `memento.exe`
2. 运行 – xray-core 已内置
3. 进入 VPN Connection → 选择配置 → Connect

### 开发者
```bash
git clone https://github.com/Epodonios/MEMENTO.git
cd MEMENTO
npm install
npm run dev
npm run build
```

---

## 📦 构建桌面应用 (.exe)

```powershell
winget install Rustlang.Rustup
rustup default stable
powershell -ExecutionPolicy Bypass -File scripts/download-xray.ps1
npm install
npm run build
npx tauri build
```

输出: `src-tauri/target/release/memento.exe` + MSI

---

## 🧠 技术栈
- 前端: React 19 + TypeScript + Vite 7 + Tailwind CSS 4
- 状态: Zustand
- 桌面: Tauri v2 (Rust)
- 核心: Xray-core v25.1.1
- Ping 引擎: Rust tokio::TcpStream 批量 (64 并发)

---

## 🔍 Ping 如何工作
- **.exe 中:** 真实 `TcpStream::connect(host:port)` – 如同 v2rayN
- **浏览器中:** WebSocket `ws://host:port` – 真实 TCP 握手
- **Spoof 模式** `127.0.0.1:40443`: 任何 >1ms 的握手 = 成功

---

## ❤️ 捐赠

> 如果这个程序让你的生活轻松了一点，帮你连上了，你可以帮助我添加更多功能，或者为你制作类似的程序。

**Tron (TRC20):** `TWdqYu5H6emRHd6jFfkHjfG8Yg2285DFmT`
**Reymit:** https://reymit.ir/epodonios

## 📬 联系我
- Telegram: https://t.me/+NqWGD5-OGv1jOGU8
- Email: Epodonios@gmail.com

## 📄 许可证 MIT
