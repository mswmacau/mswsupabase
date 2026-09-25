// 建立示範會員帳號（選用）。
// 用法：
//   SUPABASE_URL=<專案 URL> SUPABASE_SERVICE_KEY=<service_role key> node seed.mjs
// 預設只建立示範用的 runner 帳號；管理員帳號請改由 schema.sql 末尾的 SQL 指定（見 DEPLOYMENT.md）。
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!URL || !SERVICE_KEY) {
  console.error("請先設定環境變數 SUPABASE_URL 與 SUPABASE_SERVICE_KEY。");
  process.exit(1);
}

const supabase = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 示範帳號密碼固定僅供本機/測試環境使用，正式環境請自行註冊真實會員。
const USERS = [
  { email: "runner1@msw.test", password: "Test123456", name: "阿健" },
  { email: "runner2@msw.test", password: "Test123456", name: "小玲" },
  { email: "runner3@msw.test", password: "Test123456", name: "阿明" },
];

async function main() {
  for (const u of USERS) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { display_name: u.name },
    });

    if (error) {
      if (/already/i.test(error.message)) {
        console.log("EXISTS:", u.email);
      } else {
        console.log("ERROR:", u.email, error.message);
        continue;
      }
    } else {
      console.log("CREATED:", u.email, data.user.id);
    }

    // 查出 id 以便設 role
    const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 });
    const found = list?.users?.find((x) => x.email === u.email);
    if (!found) continue;

    if (u.admin) {
      const { error: upErr } = await supabase
        .from("profiles")
        .update({ role: "admin", display_name: u.name })
        .eq("id", found.id);
      console.log("  -> admin role:", upErr ? upErr.message : "OK");
    }
  }

  const { data: profs } = await supabase
    .from("profiles")
    .select("id, display_name, role, points, total_km");
  console.log("PROFILES:", JSON.stringify(profs, null, 2));
}

main();
