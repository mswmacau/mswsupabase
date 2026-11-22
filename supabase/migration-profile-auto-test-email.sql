-- =============================================================
-- migration-profile-auto-test-email.sql
-- 讓「@nokiatest.com 的測試帳號」在註冊當下自動標記 is_test = true
--
-- 【為什麼需要（2026-11-22 獨立 QA 的 P1-1）】
--   migration-profile-test-flag.sql 只做了一次性回填，條件是
--   display_name in ('nokia','test','nokiababy')。之後新建的帳號
--   **沒有任何自動標記機制**——結果是：QA／工程師開的測試號一旦提交成績
--   並被核可，就會出現在真實的公開排行榜上。
--   實測：新註冊帳號 is_test=false，核可後成績出現在未登入的 /hyrox/results。
--
-- 【做法】
--   在 handle_new_user() 的 insert 多帶一個 is_test 欄位：
--     is_test = (email 網域 = nokiatest.com)
--   函式本體其餘一字不改（以 migration-paid-events-1.sql:501 的版本為基準，
--   保留了實名／性別／電話／證後四碼的正規化邏輯）。
--
--   為什麼這裡可以放心寫 is_test：
--   guard_profile_insert（migration-profile-test-flag.sql:197）在
--   auth.uid() is null 時直接放行——註冊 trigger 正是這個情境，
--   所以寫入的 is_test 不會被守衛還原。
--
-- 【性質】
--   只做 create or replace function，不改任何表、不改任何資料。
--   既有會員的 is_test 完全不受影響（本檔不執行任何 update）。
--   可重複執行（create or replace 本身冪等）。
--
-- 【誰要跑】
--   站主在 Supabase → SQL Editor 貼上執行一次。**這是選配**：
--   不跑的話系統照常運作，只是「測試帳號」要靠人手在後台標記。
--
-- 【驗證（跑完後在 SQL Editor 執行）】
--   ① 確認函式原始碼含 is_test：
--      select prosrc like '%is_test%' as has_is_test
--        from pg_proc where proname = 'handle_new_user';
--      → 應回 true
--   ② 註冊一個 xxx@nokiatest.com 的帳號，再查：
--      select display_name, is_test from public.profiles
--       where display_name ilike '%xxx%' order by created_at desc limit 1;
--      → is_test 應為 true
--   ③ 註冊一個普通 email（例如你自己的備用信箱）→ is_test 應為 false
--
-- 【回滾】
--   重新執行 migration-paid-events-1.sql 的 §G（create or replace 回原版），
--   即回到「不自動標記」的狀態。本檔沒有改任何資料，無需資料回滾。
-- =============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display   text;
  v_full_name text;
  v_gender    text;
  v_phone     text;
  v_id_last4  text;
begin
  -- 顯示名稱：display_name → full_name → 電郵 @ 前綴
  v_display := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');

  v_full_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  if v_full_name is not null
     and (char_length(v_full_name) < 2 or char_length(v_full_name) > 40) then
    v_full_name := null;
  end if;

  v_gender := lower(btrim(coalesce(new.raw_user_meta_data ->> 'gender', '')));
  if v_gender is null or v_gender not in ('male', 'female', 'undisclosed') then
    v_gender := null;
  end if;

  v_id_last4 := regexp_replace(
                  coalesce(new.raw_user_meta_data ->> 'id_last4', ''), '\D', '', 'g');
  if v_id_last4 !~ '^[0-9]{4}$' then
    v_id_last4 := null;
  end if;

  v_phone := regexp_replace(
               coalesce(new.raw_user_meta_data ->> 'phone', ''), '[\s\-()]', '', 'g');
  -- 國碼只在後面剛好還有 8 位數字時才剝掉（lookahead），
  -- 避免把剛好以 853 開頭的 8 位本地號碼誤切成 5 位。
  v_phone := regexp_replace(v_phone, '^\+?853(?=[0-9]{8}$)', '');
  if v_phone !~ '^[0-9]{8}$' then
    v_phone := null;
  end if;

  insert into public.profiles (
    id, display_name, avatar_url, role, full_name, gender, phone, id_last4, is_test
  )
  values (
    new.id,
    coalesce(v_display, v_full_name, split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    'member',
    v_full_name,
    v_gender,
    v_phone,
    v_id_last4,
    -- 本專案的測試帳號一律用 @nokiatest.com；用網域後綴比對，
    -- 不用 ilike '%nokiatest%'（避免有人用 nokiatest@evil.com 冒充）。
    lower(split_part(coalesce(new.email, ''), '@', 2)) = 'nokiatest.com'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  '註冊時建立 profiles 列（實名／性別／電話／證後四碼正規化）。2026-11-22 起：@nokiatest.com 的帳號自動標記 is_test=true，避免測試資料上公開榜。';

-- 通知 PostgREST 重新載入 schema（只換函式本體時非必需，但無害）
notify pgrst, 'reload schema';
