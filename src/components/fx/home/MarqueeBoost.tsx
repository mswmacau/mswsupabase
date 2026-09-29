"use client";

import { useEffect } from "react";
import { prefersReducedMotion } from "./usePrefersReducedMotion";

/**
 * 基礎速度（px／秒）。可調常數：
 *  - 36  ← 而家嘅預設，貼近站內現有 CSS 版（21–36 px/s），唔突兀
 *  - 56  ← 想要多啲參考稿嗰種「能量條」活力感就用呢個
 *  - 102 ← 參考 HTML 嘅原始值（1.7px/frame @60Hz），實測偏快，唔建議
 */
const PX_PER_SEC = 36;

/**
 * 捲動加速上限（px／秒）。
 *
 * 呢度要嘅係**還原參考稿嘅手感比例**（基礎 : 加速 ≈ 1 : 27），
 * 而唔係照抄佢嘅絕對數值：
 *
 * - `1000` ← **預設**。= 基礎 36 × 27，對應參考稿嘅 1:27 比例（推薦）
 * - `2760` ← 參考稿 `min(46, …)`（每幀 46px）喺 60Hz 嘅**絕對換算**。
 *   配 102 px/s 嘅基礎先至係 1:27；配而家 36 px/s 嘅基礎會變 1:77，
 *   即「平時好溫柔、一快捲就暴衝」嘅不一致手感。
 *   **只喺客戶明確要求「保留參考稿絕對加速值」時先用。**
 * - 若基礎速度改咗，記得同步維持比例：基礎 56 → 加速約 1500（56 × 27）
 */
const MAX_BOOST_PX_PER_SEC = 1000;

/**
 * 參考 HTML：`Math.min(46, Math.abs(vy) * 1.1)`，vy 係「每幀」捲動位移。
 * 換算成每秒基準後，1.1 呢個系數直接作用喺「px／秒」嘅捲動速度上。
 */
const BOOST_K = 1.1;

/**
 * 參考 HTML：`mqBoost += (target - mqBoost) * .07`（每幀收斂 7%）。
 * 為咗喺 120Hz／144Hz 熒幕都有一樣嘅收斂手感，改用
 * `1 - (1 - 0.07)^(dt × 60)`：60Hz 嗰陣等同原本嘅 .07，其他幀率亦一致。
 */
const SMOOTH_PER_FRAME = 0.07;
const REFERENCE_FPS = 60;

/** 單幀最大 dt（秒）：分頁切去背景再返嚟時 dt 會好大，夾住避免一次跳一大段 */
const MAX_DT = 0.1;

/**
 * H-10 marquee 滾動加速（**時間基準**，唔再係每幀固定像素）
 *
 * V8 現況：`.marquee-track` 係純 CSS `animation: msw-marquee 42s linear infinite`，
 * 只有 hover pause，唔會隨捲動加速。呢度喺 JS 接管後（加 `.fx-mq-js`）
 * 關掉 CSS animation，改由 rAF 驅動。
 *
 * 點解要改時間基準：原本照抄參考稿嘅「每幀 1.7px」係幀率相依 ——
 * 60Hz 係 102px/s，120Hz 會變 204px/s，而且 102px/s 比站內現有速度
 * （21–36px/s）快咗 2.86–4.76 倍。改為 `px/s × dt` 之後，
 * 任何幀率嘅實際速度都一樣，基礎速度亦調返貼近現況。
 *
 * ✅ 失敗安全：JS 冇跑 → `.fx-mq-js` 唔會出現 → 繼續用原本嘅 CSS animation，
 * 跑馬燈照樣行；hover pause 行為亦保留（用 paused flag 模擬）。
 */
export function MarqueeBoost() {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    const track = document.querySelector<HTMLElement>("[data-fx-marquee]");
    if (!track) return;

    track.classList.add("fx-mq-js");

    let x = 0;
    let boost = 0;
    let lastY = window.scrollY;
    let lastTime = -1;
    let paused = false;
    let raf = 0;

    const scope = track.closest<HTMLElement>(".marquee");
    const onEnter = () => {
      paused = true;
    };
    const onLeave = () => {
      paused = false;
    };
    scope?.addEventListener("mouseenter", onEnter);
    scope?.addEventListener("mouseleave", onLeave);

    const loop = (now: number) => {
      if (lastTime < 0) lastTime = now; // 第一幀只記時間，唔位移
      const dt = Math.min(MAX_DT, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;

      const y = window.scrollY;
      const dy = y - lastY;
      lastY = y;

      // 捲動速度換算成 px／秒；dt 太細當 0，避免除以極小數放大雜訊
      const velocity = dt > 0.001 ? Math.abs(dy) / dt : 0;
      const target = Math.min(MAX_BOOST_PX_PER_SEC, velocity * BOOST_K);
      const smooth =
        1 - Math.pow(1 - SMOOTH_PER_FRAME, dt * REFERENCE_FPS);
      boost += (target - boost) * smooth;

      if (!paused && dt > 0) {
        x -= (PX_PER_SEC + boost) * dt;
        const half = track.scrollWidth / 2;
        if (half > 0 && x <= -half) x += half; // 半寬回捲（同 CSS -50% 一致）
        track.style.transform = `translate3d(${x}px, 0, 0)`;
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(raf);
      scope?.removeEventListener("mouseenter", onEnter);
      scope?.removeEventListener("mouseleave", onLeave);
      track.classList.remove("fx-mq-js");
      track.style.transform = "";
    };
  }, []);

  return null;
}
