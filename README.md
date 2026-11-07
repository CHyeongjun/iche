# 🌌 Personal Record Hub - Vercel Serverless Architecture

사이버네틱 디자인과 엔터프라이즈급 보안 아키텍처가 결합된 **개인 기록 보관소(Personal Record Hub)**입니다.  
기존 Supabase 종속성을 완전히 걷어내고, **Vercel Serverless Functions (`api/`)**와 고도화된 정적 프론트엔드로 완벽 마이그레이션되었습니다.

---

## 📁 파일 구성 및 역할

| 파일명 | 종류 | 설명 |
|---|---|---|
| `api/auth.js` | ⚡ Vercel API | **관리자 인증 서버리스 함수**: HMAC 기반 세션 토큰 발행 및 비밀번호 검증 |
| `api/records.js` | ⚡ Vercel API | **기록 CRUD 서버리스 함수**: 게스트(Public만 열람) vs 관리자(Private 포함 작성/수정/삭제) 권한 격리 |
| `vercel.json` | ⚙️ Vercel 설정 | 보안 헤더(`X-Frame-Options`, `X-Content-Type-Options` 등) 및 라우팅 구성 |
| `guard.src.js` | 🔒 소스 | **0초 센티널 보안 가드 원본**: F12 개발자 도구 0초 차단, 단축키/우클릭 차단 |
| `guard.js` | 🚀 배포용 | `build.ps1`을 통해 고강도 2중 난독화된 센티널 가드 배포본 |
| `app.src.js` | 🔒 소스 | **코어 애플리케이션 프레임워크 원본**: 2분할 실시간 미리보기, Vercel REST 연동, 세션 관리 |
| `app.js` | 🚀 배포용 | `build.ps1`을 통해 난독화된 메인 프레임워크 배포본 |
| `index.html` | 🌐 뼈대 | 엄격한 CSP, 사이버네틱 3D 입체 공간 레이어, 2분할 모달 구조의 마크업 |
| `styles.css` | 🎨 스타일 | 3D 지평선 원근 그리드 애니메이션, 레이저 글로우, 사이버네틱 ✕ 버튼 및 모달 스타일 |
| `build.ps1` | ⚙️ 빌더 | `guard.src.js`와 `app.src.js`를 즉시 난독화 배포본(`guard.js`, `app.js`)으로 컴파일 |
| `.gitignore` | 🛡️ 보호 | 원본 소스(`.src.js`), 빌더(`build.ps1`) 등이 깃에 유출되지 않도록 철저 보호 |

---

## 🔒 탑재된 핵심 보안 레이어

1. **0초 안티 디버깅 센티널 가드 (`guard.js`)**
   - 브라우저 개발자 도구(F12)가 켜진 상태에서 접속/새로고침 시 0초 만에 감지하여 화면을 즉시 블라인드 처리합니다.
   - 단축키(`F12`, `Ctrl+Shift+I/J/C`, `Ctrl+U`, `Ctrl+S` 등) 및 우클릭 메뉴가 원천 차단됩니다.

2. **Vercel Serverless 권한 격리 (Public vs Private)**
   - 방문자(Guest)에게는 `is_private: true` 데이터가 API 레벨에서 원천적으로 필터링되어 유출되지 않습니다.
   - 관리자 인증을 마친 클라이언트만 Authorization Bearer 토큰을 통해 Private 기록에 접근할 수 있습니다.

3. **안전한 세션 어댑터 (Zero LocalStorage)**
   - `localStorage`를 0% 사용하여 영구 디스크에 인증 토큰을 저장하지 않습니다.
   - 현재 탭이 열려있는 동안만 세션이 유지되며, 브라우저 탭을 닫으면 즉시 영구 소멸됩니다.

4. **XSS(크로스 사이트 스크립팅) 원천 살균 엔진**
   - 허용되지 않은 HTML 태그, 인라인 악성 스크립트, `javascript:` 의사 프로토콜을 철저히 검증 및 살균합니다.

---

## 🚀 Vercel 배포 가이드

1. **GitHub 저장소 푸시**
   - `.gitignore`가 설정되어 있으므로 안전하게 프로젝트를 GitHub에 푸시합니다.

2. **Vercel에서 프로젝트 Import**
   - [Vercel Dashboard](https://vercel.com)에서 **Add New Project** 클릭 후 GitHub 저장소를 선택합니다.
   - **Framework Preset**: `Other` 선택 (Static + Serverless API 자동 인식)

3. **환경 변수(Environment Variables) 설정**
   - Vercel 프로젝트 대시보드의 **Settings > Environment Variables**에서 아래 항목을 등록합니다:
     - `ADMIN_PASSWORD`: 관리자 접속용 비밀번호 (설정하지 않을 시 기본값 `1234`로 동작)
     - `TOKEN_SECRET`: 세션 토큰 서명용 임의의 비밀 키 문자열 (선택 사항)

4. **배포 완료(Deploy)**
   - **Deploy** 버튼을 누르면 단 몇 초 만에 전 세계 엣지 네트워크로 자동 배포됩니다.

---

## ⚙️ 로컬 빌드 방법

소스코드(`app.src.js`, `guard.src.js`)를 수정한 후 터미널(PowerShell)에서 아래 명령어를 실행하면 배포 파일이 즉시 갱신됩니다:
```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```
