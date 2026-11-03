-- ==============================================================================
-- 🚀 Vibe Blog - Supabase 통합 데이터베이스 스키마 및 보안 정책
-- ==============================================================================
-- [사용 방법]
-- 1. Supabase 대시보드(https://supabase.com)에 로그인 후 해당 프로젝트를 엽니다.
-- 2. 왼쪽 메뉴에서 [SQL Editor]를 클릭하고 [New query]를 누릅니다.
-- 3. 아래 SQL 전체를 복사하여 붙여넣습니다.
-- 4. 맨 아래 4번 항목의 '여기에_원하는_비밀번호_입력' 부분에 실제 사용할 관리자 비밀번호를 입력합니다.
-- 5. [Run] (실행) 버튼을 클릭하면 모든 테이블 생성, RLS 보안 정책, 관리자 계정이 즉시 세팅됩니다!
-- ==============================================================================

-- 0. 비밀번호 암호화 확장 활성화
create extension if not exists pgcrypto;

-- 1. 블로그 포스트 테이블 생성
create table if not exists public.posts (
  id bigint primary key,
  title text not null,
  category text not null,
  date text not null,
  tags jsonb default '[]'::jsonb,
  image text,
  images jsonb default '[]'::jsonb,
  excerpt text,
  content text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 기존에 posts 테이블이 이미 생성되어 있던 경우를 대비한 컬럼 및 타입 보정
alter table public.posts add column if not exists tags jsonb default '[]'::jsonb;
alter table public.posts add column if not exists image text;
alter table public.posts add column if not exists images jsonb default '[]'::jsonb;
alter table public.posts add column if not exists excerpt text;
alter table public.posts add column if not exists content text;
alter table public.posts alter column id type bigint;

-- 2. Row Level Security(RLS - 행 단위 보안) 활성화
--    RLS가 켜지면 인가되지 않은 모든 직접 DB 조작이 서버 레벨에서 차단됩니다.
alter table public.posts enable row level security;

-- 기존 구버전 정책 일괄 정리
drop policy if exists "공개 쓰기" on public.posts;
drop policy if exists "공개 삭제" on public.posts;
drop policy if exists "공개 수정" on public.posts;
drop policy if exists "공개 읽기" on public.posts;
drop policy if exists "관리자 쓰기" on public.posts;
drop policy if exists "관리자 수정" on public.posts;
drop policy if exists "관리자 삭제" on public.posts;
drop policy if exists "관리자 전체 권한" on public.posts;

-- 3. RLS 보안 정책 생성
-- (1) 누구나(일반 방문자) 블로그 글을 조회하고 읽을 수 있습니다.
create policy "공개 읽기" on public.posts
  for select
  using (true);

-- (2) 글 등록: Supabase 서버 인증을 통과한 관리자(admin@vibe.blog)만 허용
create policy "관리자 쓰기" on public.posts
  for insert to authenticated
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'admin@vibe.blog');

-- (3) 글 수정: Supabase 서버 인증을 통과한 관리자(admin@vibe.blog)만 허용
create policy "관리자 수정" on public.posts
  for update to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'admin@vibe.blog')
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'admin@vibe.blog');

-- (4) 글 삭제: Supabase 서버 인증을 통과한 관리자(admin@vibe.blog)만 허용
create policy "관리자 삭제" on public.posts
  for delete to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'admin@vibe.blog');

-- 4. 관리자 계정 생성 및 비밀번호 설정 (자동화 스크립트)
-- ★ 아래 '여기에_원하는_비밀번호_입력' 부분을 실제 사용할 관리자 비밀번호로 변경하세요!
-- ★ 추후 비밀번호를 바꾸고 싶을 때도 비밀번호만 바꿔서 다시 Run 하시면 됩니다.
do $$
declare
  -- ▼▼▼ 여기에 사용할 비밀번호를 입력하세요 ▼▼▼
  v_password text := '여기에_원하는_비밀번호_입력';
  -- ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
  v_user_id uuid := gen_random_uuid();
  v_encrypted_pw text;
begin
  v_encrypted_pw := crypt(v_password, gen_salt('bf'));

  -- 계정이 이미 존재할 때: 비밀번호 변경
  if exists (select 1 from auth.users where email = 'admin@vibe.blog') then
    update auth.users
    set encrypted_password = v_encrypted_pw,
        updated_at = now()
    where email = 'admin@vibe.blog';
  else
    -- 계정이 없을 때: 관리자 계정 신규 생성
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      'admin@vibe.blog',
      v_encrypted_pw,
      now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      now(),
      now()
    );

    insert into auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      v_user_id,
      v_user_id,
      format('{"sub":"%s","email":"%s"}', v_user_id::text, 'admin@vibe.blog')::jsonb,
      'email',
      v_user_id::text,
      now(),
      now(),
      now()
    );
  end if;
end $$;

-- 5. (안내) 외부 가입 차단 설정 권장
-- Supabase 대시보드 > [Authentication] > [Sign In / Providers] > [Email] 에서
-- "Allow new users to sign up" 설정을 꺼주시면 외부인이 임의로 계정을 만드는 것까지 완벽히 차단됩니다.
