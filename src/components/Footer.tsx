import Link from "next/link";
import { AtSign, Mail, MapPin, Shield } from "lucide-react";
import { BRAND, NAV_LINKS } from "@/lib/config";

/** 未登入顯示註冊／登入；已登入只顯示會員專區，並用「管理員入口」進後台 */
export function Footer({
  isLoggedIn = false,
  isAdmin = false,
  brandName = BRAND.name,
  brandNameEn = BRAND.nameEn,
}: {
  isLoggedIn?: boolean;
  isAdmin?: boolean;
  brandName?: string;
  brandNameEn?: string;
}) {
  return (
    <footer className="border-t border-ink-line bg-ink">
      <div className="container-msw py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-vital text-sm font-black text-white">
                MSW
              </span>
              <div className="leading-tight">
                <div className="font-extrabold">{brandName}</div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
                  {brandNameEn}
                </div>
              </div>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/55">
              {BRAND.description.slice(0, 90)}…
            </p>
          </div>

          <div>
            <h4 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-white/40">
              活動
            </h4>
            <ul className="space-y-2.5 text-sm text-white/70">
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="transition hover:text-vital">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-white/40">
              會員
            </h4>
            <ul className="space-y-2.5 text-sm text-white/70">
              {!isLoggedIn && (
                <>
                  <li>
                    <Link href="/signup" className="transition hover:text-vital">
                      註冊會員
                    </Link>
                  </li>
                  <li>
                    <Link href="/login" className="transition hover:text-vital">
                      會員登入
                    </Link>
                  </li>
                </>
              )}
              {isLoggedIn && (
                <>
                  <li>
                    <Link
                      href="/dashboard"
                      className="transition hover:text-vital"
                    >
                      我的帳戶
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/dashboard/coupons"
                      className="transition hover:text-vital"
                    >
                      我的優惠券
                    </Link>
                  </li>
                </>
              )}
              {isAdmin && (
                <li>
                  <Link href="/admin" className="transition hover:text-vital">
                    後台管理
                  </Link>
                </li>
              )}
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-white/40">
              聯絡我們
            </h4>
            <ul className="space-y-3 text-sm text-white/70">
              <li className="flex items-start gap-2.5">
                <MapPin size={16} className="mt-0.5 shrink-0 text-vital" />
                <span>{BRAND.location}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Mail size={16} className="mt-0.5 shrink-0 text-vital" />
                <span>{BRAND.email}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <AtSign size={16} className="mt-0.5 shrink-0 text-vital" />
                <span>{BRAND.instagram}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-ink-line pt-6 text-xs text-white/40 sm:flex-row">
          <span>
            © {new Date().getFullYear()} {brandName} · {brandNameEn}
          </span>
          <div className="flex items-center gap-4">
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 transition hover:text-white/70"
            >
              <Shield size={13} /> 管理員入口
            </Link>
            <span>使用 Next.js + Supabase 建置</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
