"use client";

import { useRef } from "react";
import { useRafScroll } from "./useRafScroll";

/**
 * H-01 頂部閱讀進度條
 *
 * 參考 HTML：`progBar.style.width = (y/(body.scrollHeight-innerHeight)*100)+'%'`
 * 呢度改用 documentElement.scrollHeight（body 係 flex 容器，量起來會唔準）。
 *
 * 點解要自己加而唔係復修 layout.tsx 嘅 <NavProgress/>：
 *   1. NavProgress 屬於共用 layout，改佢會影響全部 7 個頁面（超出「只改首頁」範圍）；
 *   2. 兩者根本係兩種嘢 —— NavProgress 係「路由切換載入條」，
 *      呢條 ScrollProgress 係「捲動閱讀進度條」（即客戶想要嘅 H-01）。
 *      換頁嗰一瞬間兩條會同時出現喺畫面頂，屬預期行為，處置方式見 README §4.3。
 *
 * 失敗時嘅行為：JS 冇跑到就係一條 width:0 嘅透明細線，完全唔影響內容。
 */
export function ScrollProgress() {
  const barRef = useRef<HTMLDivElement>(null);

  useRafScroll(() => {
    const bar = barRef.current;
    if (!bar) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const y = window.scrollY;
    bar.style.width = `${max > 0 ? (y / max) * 100 : 0}%`;
  });

  // 純裝飾：進度只係視覺提示，對輔助技術冇意義，所以整條 bar 隱藏起來
  return (
    <div
      ref={barRef}
      className="fx-progress"
      role="presentation"
      aria-hidden="true"
    />
  );
}
