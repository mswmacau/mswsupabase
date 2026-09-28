"use client";

import { useEffect, useRef } from "react";

type Handler = () => void;

/**
 * 全站共用嘅「一幀只算一次」捲動訂閱。
 *
 * 點解唔喺每個元件各自 addEventListener('scroll')：
 * 首頁同時有進度條／回頂部環／漂移大字／逐字 scrub 都要聽捲動，
 * 各自註冊會變成 4 個 listener + 4 條 rAF 鏈。呢度統一成
 * 「1 個 passive listener + 1 條 rAF 鏈 + N 個 callback」，
 * 行為同參考 HTML 嘅 sTick 模式一致（一幀最多算一次）。
 *
 * 冇訂閱者時會自動解綁（唔會留低空轉嘅 listener）。
 */
const handlers = new Set<Handler>();
let frame: number | null = null;
let bound = false;

function flush(): void {
  frame = null;
  // 複製一份：callback 入面有機會新增／移除訂閱者
  for (const h of Array.from(handlers)) h();
}

function schedule(): void {
  if (frame !== null) return; // 呢一幀已經排咗
  frame = window.requestAnimationFrame(flush);
}

function bind(): void {
  if (bound) return;
  bound = true;
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
}

function unbind(): void {
  if (!bound) return;
  bound = false;
  window.removeEventListener("scroll", schedule);
  window.removeEventListener("resize", schedule);
  if (frame !== null) {
    window.cancelAnimationFrame(frame);
    frame = null;
  }
}

/**
 * @param handler 每幀最多執行一次嘅量測／寫 style 邏輯
 * @param enabled false 時完全唔訂閱（例如 prefers-reduced-motion）
 */
export function useRafScroll(handler: Handler, enabled = true): void {
  const ref = useRef<Handler>(handler);

  // handler 通常係每次 render 都重新產生嘅 closure，呢度保持最新
  useEffect(() => {
    ref.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;
    const fn = () => ref.current();
    handlers.add(fn);
    bind();
    fn(); // 掛載後先同步一次，避免要等到第一次捲動先有正確狀態
    return () => {
      handlers.delete(fn);
      if (handlers.size === 0) unbind();
    };
  }, [enabled]);
}
