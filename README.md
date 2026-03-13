# 🎬 Genga Movie Desktop (v1.0.0)

**Genga Movie** is a premium, standalone desktop application designed for the ultimate media discovery and playback experience. Built with a high-performance hybrid architecture, it aggregates metadata and streams from across the web—including Movies, Anime, Manga, Music, and Light Novels—into a single, stunning glassmorphic interface.

> [!IMPORTANT]
> **v1.1.6 is Natively Standalone.** Users are no longer required to install Python, Node.js, or any external dependencies. All engines are bundled directly into the application.

---

## 🎯 The Genga Vision

### What this is
-   A **Premium Meta-Aggregator** for Hollywood, Bollywood, Anime, and more.
-   A **Native Powerhouse** using internal Python and Node.js engines for scraping.
-   A **Privacy-First Client** that handles all requests locally with advanced header masking.

### What this is not
-   A content host or distribution service.
-   A cloud-dependent web wrapper (Everything runs on *your* machine).

---

## ✨ Key Features (v1.1.6)

-   **🚀 Zero-Configuration Portable Build**: Just run `GengaMovieSetup.exe`. No CLI, no `pip install`, no terminal.
-   **📺 Definitive YouTube Fix (Error 152)**: Surgical header injection bypasses embedding restrictions, enabling seamless playback of YouTube Live streams.
-   **⚛️ Hybrid Native Engine**:
    *   **Python Core**: Powers MovieBox, GaanaPy (Music), and LNCrawl (Novels).
    *   **Node Bridge**: Powers HiAnime (Anime) and Consumet/MangaPill.
-   **📖 460+ Novel Sources**: Integrated the world-class LNCrawl engine directly into the desktop UI.
-   **🎵 Direct Music Streaming**: High-quality regional charts and search powered by native GaanaPy.
-   **📥 Unified Downloader**: High-speed parallel download tunneling for Movies and Series.
-   **🎭 Premium Aesthetics**: State-of-the-art glassmorphism, smooth animations, and persistent state management.

---

## 📸 Section Overview

| Section | Description |
| :--- | :--- |
| **Home** | Global discovery across all media types. |
| **MovieBox** | 4K/HD Movies and Series with native subtitle support. |
| **Anime** | Powered by native `@genga-movie/aniwatch` library. |
| **Manga** | Advanced reader for MangaPill and global sources. |
| **Music** | native GaanaPy integration for regional charts. |
| **Novels** | Full LNCrawl integration with 460+ scrapers. |
| **Live TV** | IPTV and YouTube Live integration with restriction bypass. |

---

## 🧰 The Standalone Tech Stack

**The GUI**
-   **Electron 31**: The desktop framework.
-   **React 18 + Vite**: The high-speed frontend UI.

**The Engines (Internal)**
-   **Python 3.14 (Bundled)**: FastAPI core handling heavy lifting and async I/O.
-   **Node.js (UtilityProcess)**: Internal Electron sub-processes for Javascript-based scrapers.

---

## 🧠 Native Architecture (v1.1.6)

Unlike previous web-only versions, Genga Movie Desktop runs as a 3-tier local system:

1.  **The GUI (Renderer)**: Handles the premium React interface.
2.  **The Core (Python)**: A high-performance FastAPI server packaged as `backend.exe`. It executes `moviebox-api`, `gaanapy`, and `lncrawl` natively on your CPU.
3.  **The Bridge (Node)**: An internal `UtilityProcess` spawned by Electron that hosts native JS scrapers (`@consumet/extensions`, `@genga-movie/aniwatch`). 

**Requests never touch central servers; everything is scraped from your IP, for your app.**

---

## 🚀 Setup & Usage

### For Users
Simply download and run the latest installer:
1.  Download **[GengaMovieSetup.exe](dist/GengaMovieSetup.exe)**.
2.  Install and Launch.
3.  Enjoy a completely self-contained experience.

### For Developers
If you wish to modify the source code:

**1. Backend (Python)**
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --port 8000
```

**2. Node Bridge**
```bash
npm install
node node-bridge.js
```

**3. Frontend**
```bash
cd frontend
npm install
npm run dev
```

---

## 🛡️ License & Disclaimer

**Educational Purposes Only.** This software does not host or own any media content. It is a client-side interface for existing third-party APIs. Users are responsible for ensuring compliance with local laws.

Licensed under the **AGPL-3.0**. See `LICENSE` for details.
