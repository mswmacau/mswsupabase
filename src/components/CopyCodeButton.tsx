"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * 券碼一鍵複製：掃不到碼時，店員可以人手輸入。
 * Clipboard API 失敗（非 HTTPS／權限被拒）時退回 textarea + execCommand。
 */
export function CopyCodeButton({
  code,
  className = "",
}: {
  code: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* 最後手段也失敗：不阻斷流程，會員仍可長按選取 */
      }
      document.body.removeChild(ta);
    }

    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "已複製領取碼" : "複製領取碼"}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 border border-white/20 bg-white/5 px-3 text-xs font-semibold text-white/85 transition hover:border-white/45 hover:bg-white/10 ${className}`}
    >
      {copied ? (
        <>
          <Check size={14} className="text-emerald-300" /> 已複製
        </>
      ) : (
        <>
          <Copy size={14} /> 複製券碼
        </>
      )}
    </button>
  );
}
