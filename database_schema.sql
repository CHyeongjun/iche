-- =========================================
-- 블로그 원격 데이터베이스 테이블 및 보안 정책 설정 (관리자 참고용)
-- =========================================

-- 1. 포스트 테이블 생성
create table if not exists posts (
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

-- 2. 행 단위 보안(RLS) 활성화 (필수)
alter table posts enable row level security;

-- 3. [공개 읽기] 일반 방문자: 글 읽기(SELECT)만 허용
drop policy if exists "공개 읽기" on posts;
create policy "공개 읽기" on posts for select using (true);

-- 4. [보안 조치] 무단 쓰기/삭제 차단:
-- "공개 쓰기", "공개 삭제"가 열려 있으면 관리자 권한 없는 제3자가 DB에 직접 글을 삭제/조작할 수 있습니다.
-- 따라서 공개 쓰기/삭제 정책을 삭제하여 일반 방문자의 임의 조작을 원천 차단합니다.
drop policy if exists "공개 쓰기" on posts;
drop policy if exists "공개 삭제" on posts;

