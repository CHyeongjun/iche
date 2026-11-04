-- ==============================================================================
-- 🚀 Vibe Blog - Supabase 통합 데이터베이스 스키마 및 보안 정책
-- ==============================================================================
-- [사용 방법]
-- 1. Supabase 대시보드(https://supabase.com)에 로그인 후 해당 프로젝트를 엽니다.
-- 2. 왼쪽 메뉴에서 [SQL Editor]를 클릭하고 [New query]를 누릅니다.
-- 3. 아래 SQL 전체를 복사하여 붙여넣고 [Run] (실행) 버튼을 클릭합니다.
-- 4. "Success. No rows returned"가 뜨면 완료됩니다!
-- ==============================================================================

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

-- ==============================================================================
-- 4. 🔒 최소 권한 원칙(Principle of Least Privilege) 적용
-- ==============================================================================
-- 비로그인(anon) 사용자가 posts 테이블 외에 다른 내부 스키마나 함수, 권한 정보를
-- 탐색하거나 조작하지 못하도록 서버 레벨에서 접근 권한을 철저하게 최소화합니다.
revoke all on schema public from anon;
grant usage on schema public to anon, authenticated;
revoke all on all tables in schema public from anon;
grant select on public.posts to anon;
grant select, insert, update, delete on public.posts to authenticated;

-- 5. (선택사항) 만약 이전에 잘못 생성된 찌꺼기 계정으로 로그인이 꼬였을 때만 아래 주석을 풀고 1회 실행하세요.
-- delete from auth.users where email = 'admin@vibe.blog';
