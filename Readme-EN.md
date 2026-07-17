<div align="center">

# 🌟 MEMENTO V2Ray Config Editor 🚀

**A powerful, fast, and sleek V2Ray configuration editor for Windows**


![MEMENTO Banner](https://via.placeholder.com/1280x640/050806/22c55e?text=MEMENTO+Config+Editor)

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)
![Tech](https://img.shields.io/badge/tech-React%20%2B%20Tauri%20%2B%20Rust-yellow.svg)

</div>

---

### ❤️ Dedication
> *I dedicate this program to A Who. Even though I don't have her anymore, she taught me what love is. If you'd like, you can join my Telegram channel — you might find it a little entertaining.*
>
> Telegram: **https://t.me/+NqWGD5-OGv1jOGU8** | Email: **Epodonios@gmail.com**

## ❤️ Donate

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



### ❤️Reymit (Iranian):
[https://reymit.ir/epodonios](https://reymit.ir/epodonios)



## 📖 About MEMENTO

**MEMENTO** is a modern Windows tool for managing, editing, and connecting to V2Ray/Xray configurations. With a Glassmorphism UI and smooth animations, it provides a professional experience for bypassing internet censorship.

**MEMENTO** is a powerful and elegant V2Ray config editor built for Windows. It allows you to import, edit, scan, and connect thousands of configs with ease. Enjoy a modern UI, Iran Mode (Domain Fronting), real-time traffic stats, Auto Failover, and QR Code sharing.

---

## ✨ Key Features

### 🚀 **Config Management**
- **Advanced Import/Export:** Import from text, clipboard, TXT files, or subscription URLs (Base64). Export in Raw, Base64, JSON, Clash, Surge, Sing-Box formats.
- **Bulk Tools:** Deduplicate, sort (name, protocol, ping), bulk rename, and advanced multi-select filters (Transport, Port, Protocol, Ping).
- **Subscription Groups:** Create and manage groups with auto-update and grouped exports.

### 🌐 **VPN Connection**
- **Real Xray Connection:** Bundled Xray-core (v25.1.1) for Vmess, Vless, Trojan, Shadowsocks, Hysteria2, TUIC.
- **Live Stats:** Real-time download/upload, PID, Uptime, and live logs.
- **Auto Failover:** Automatically reconnects to another config (same group or all configs, same port or different) if connection drops.
- **Spoofing Patt Integration:** Runs Spoofing Patt with admin rights to bypass network restrictions.

### ⚡ **Scanners & Pinger**
- **Config Pinger:** Fast native TCP ping for hundreds of configs per second, like v2rayN.
- **IP Scanner:** Scans IPs for healthy CDNs with persistent results.
- **Persistent Memory:** Results stay even when switching tabs.

### 🛠️ **Editor**
- **IP Range:** Clone configs over an IP range (e.g., for CDN testing).
- **Spoof:** Replace IP and port of all configs with custom values.

### 🇮🇷 **Iran Mode**
- **Domain Fronting:** Hide your traffic behind legitimate domains (Google, Microsoft, Akamai) to bypass SNI-based censorship.
- **Advanced Settings:** DoH Server, Local Proxy Port, Front Rules.
- **Psiphon & SNI Tunnel:** (Coming soon) for advanced censorship circumvention.

### 🎨 **Design & UX**
- **Glassmorphism UI:** Dark mode with green/purple gradients.
- **Responsive:** Fully responsive for mobile and Split View.
- **Custom Cursor:** White custom cursor throughout the app.
- **Custom Title Bar:** Minimize/Maximize/Close buttons with app theme.
- **Animations:** Fade-in, Pop-in, Stagger, Hover Lift, Shine Effect everywhere.
- **Keyboard Shortcuts:** Ctrl+C (copy), Ctrl+V (paste), Enter (connect), Shift+Click (group select).
- **QR Code:** Generate QR codes for mobile sharing.
- **Base64/QR Share:** Share configs via Base64 or QR Code.

---

## 📦 Download & Install

### Method 1: Pre-built (Portable)
1. Go to [Releases](https://github.com/Epodonios/memento/releases).
2. Download `MEMENTO.exe` (portable, no installation required).
3. Run and enjoy!

## 🛠️ Tech Stack

| Section | Technology |
|---------|------------|
| **Frontend** | React 19, TypeScript, Tailwind CSS, Vite |
| **State Management** | Zustand |
| **Backend (Desktop)** | Tauri 2.0 (Rust) |
| **Icons** | Lucide React |
| **QR Code** | react-qr-code |
| **Notifications** | react-hot-toast |
| **Xray Core** | XTLS/Xray-core (v25.1.1) |

---

## 📂 Project Structure

```
memento/
├── src/                    # React frontend
│   ├── components/         # UI components
│   │   ├── ConfigsTab.tsx      # Config table
│   │   ├── ConnectionTab.tsx   # VPN connection
│   │   ├── PingerTab.tsx       # Config pinger
│   │   ├── ScannerTab.tsx      # IP scanner
│   │   ├── ExportTab.tsx       # Export
│   │   ├── EditorTab.tsx       # Editor (IP Range / Spoof)
│   │   ├── DomainFrontingTab.tsx # Domain Fronting (Iran Mode)
│   │   ├── DonateTab.tsx       # Donate
│   │   ├── ContactTab.tsx      # Contact
│   │   ├── ImportTab.tsx       # Import links
│   │   ├── Sidebar.tsx         # Sidebar
│   │   ├── TitleBar.tsx        # Custom title bar
│   │   ├── ConnectionManager.tsx # Background connection manager
│   │   └── ... (other files)
│   ├── utils/              # Utilities
│   │   ├── ping.ts             # Native/browser ping
│   │   ├── fastPing.ts         # Multi ping
│   │   ├── v2rayConfig.ts      # Xray config generator
│   │   ├── connectionActions.ts # Connection actions
│   │   └── subscription.ts     # Subscription downloader
│   ├── store.ts            # State management (Zustand)
│   └── main.tsx            # Entry point
├── src-tauri/              # Tauri backend (Rust)
│   ├── src/
│   │   ├── lib.rs          # Core Rust logic
│   │   └── main.rs         # Tauri entry point
│   ├── capabilities/       # Tauri permissions
│   ├── resources/          # Bundled files
│   │   ├── xray.exe            # Xray-core
│   │   ├── geoip.dat           # GeoIP database
│   │   ├── geosite.dat         # GeoSite database
│   │   ├── domain-fronting/    # Domain fronting tool
│   │   └── spoofing-patt/      # Spoofing Patt tool
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri config
├── scripts/                # Helper scripts
│   └── download-xray.ps1   # Auto Xray downloader
├── public/                 # Static files
├── package.json            # Node dependencies
├── vite.config.ts          # Vite config
└── README.md               # This file
```

---

## 🚀 How to Use

### 1. Import Configs
- Go to **Import Links** tab.
- Paste configs, read from clipboard, or import from TXT file/subscription URL.
- Auto-decodes Base64 subscriptions.

### 2. Manage Configs
- Go to **Config Table** tab.
- **Search**, **filter** by protocol/status/ping.
- **Create Subscription Groups** and group configs.
- **Quick Connect** for instant VPN connection to a specific config.
- **Share** to copy Base64 or show QR Code for a config.

### 3. Connect to VPN
- Go to **VPN Connection** tab.
- Select a valid config and click **Connect**.
- View live stats (download/upload, Uptime).
- Enable **Auto Failover** to automatically reconnect to another config if dropped.
- Run **Spoofing Patt** to bypass network restrictions.

### 4. Scan & Ping
- **Config Pinger:** For fast pinging hundreds of configs.
- **IP Scanner:** For finding healthy CDN IPs (e.g., for V2Ray).

### 5. Export
- Go to **Export** tab.
- Select output format (Raw, Base64, JSON, Clash, Surge, Sing-Box).
- Apply **Advanced Filters** (Transport, Port, Protocol, Ping).
- Enable **Bulk Rename** and set naming pattern.
- Copy or download the output.


---



### Report Bugs or Request Features:
- Go to [Issues](https://github.com/Epodonios/memento/issues) and submit your report or suggestion.

---

## 📄 License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.

---

## 🙏 Special Thanks

- **XTLS/Xray-core** for the powerful proxy engine.
- **Tauri** for fast and secure desktop apps.
- **Lucide React** for beautiful icons.
- **Zustand** for simple and powerful state management.
- **Tailwind CSS** for fast and modern styling.

---

<div align="center">

**Built with ❤️ by Epodonios**

![GitHub Stars](https://img.shields.io/github/stars/yourusername/memento.svg?style=social&label=Star)
![GitHub Forks](https://img.shields.io/github/forks/yourusername/memento.svg?style=social&label=Fork)
![GitHub Watchers](https://img.shields.io/github/watchers/yourusername/memento.svg?style=social&label=Watch)

</div>
