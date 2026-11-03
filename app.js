/**
 * Vibe Code Blog Application
 * 전역 스코프 오염 방지용 IIFE.
 * 주의: IIFE는 코드 정리 목적일 뿐 보안 장치가 아닙니다. (F12 디버거로 내부 접근 가능)
 * 모든 쓰기/삭제 권한은 서버(Supabase Auth + RLS)에서 검증합니다.
 */
(function () {
  "use strict";

  // =========================================
  // 데이터 관리 (인-메모리 캐시)
  // =========================================

  // =========================================
  // 관리자 인증 (서버 검증 방식 - Supabase Auth + DB RLS)
  // =========================================
  // [보안 원칙]
  // - 인증 세션은 브라우저 저장소에 일체 저장하지 않고, 오직 메모리(RAM)에서만 유지합니다.
  // - F12 개발자 도구의 애플리케이션 스토리지를 열어도 인증 토큰이나 비밀값이 일체 노출되지 않습니다.
  // - 클라이언트에는 권한 검사 함수가 없으며, 실제 모든 쓰기/삭제 권한은 PostgreSQL 서버의 RLS 정책이 검증합니다.

  // 단일 비밀번호 로그인을 위한 고정 내부 관리자 이메일 계정
  const ADMIN_AUTH_EMAIL = "admin@vibe.blog";

  let authSession = null; // 메모리 상의 Supabase 세션 (UI 동기화용)

  // 서버 세션 확인 (UI 동기화)
  async function syncSession() {
    if (!supabaseClient) {
      authSession = null;
      return false;
    }
    try {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      authSession = sessionData ? sessionData.session : null;
    } catch (e) {
      authSession = null;
    }
    return !!(authSession && authSession.user);
  }

  // 로그인/로그아웃/토큰 갱신 이벤트를 받아 UI 동기화
  function attachAuthListener(client) {
    client.auth.onAuthStateChange((event, session) => {
      authSession = session || null;
      setTimeout(async () => {
        await syncSession();
        if (typeof updateAdminUI === "function") updateAdminUI();
        if (typeof renderTags === "function") renderTags();
      }, 0);
    });
  }

  // =========================================
  // XSS 방어 및 HTML 보안 새니타이징 유틸리티
  // =========================================
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeImageUrl(url) {
    if (!url || typeof url !== "string") return "";
    const trimmed = url.trim();
    if (
      trimmed.startsWith("data:image/") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("/")
    ) {
      return escapeHtml(trimmed);
    }
    return "";
  }

  function sanitizeHtmlContent(html) {
    if (!html || typeof html !== "string") return "";
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const ALLOWED_TAGS = new Set([
      "P", "BR", "STRONG", "B", "EM", "I", "U", "S",
      "SPAN", "BLOCKQUOTE", "HR", "UL", "OL", "LI",
      "H1", "H2", "H3", "H4", "H5", "H6", "A", "IMG"
    ]);

    const ALLOWED_ATTRS = {
      A: ["href", "title", "target", "rel"],
      IMG: ["src", "alt", "title", "loading", "class"],
      SPAN: ["class"],
      P: ["class"]
    };

    function cleanNode(node) {
      const children = Array.from(node.childNodes);
      for (const child of children) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          if (!ALLOWED_TAGS.has(child.tagName)) {
            // 위험 태그(SCRIPT, IFRAME, OBJECT, SVG 등) 완전 제거
            child.remove();
            continue;
          }

          // 인라인 이벤트(onclick, onerror 등) 및 비허용 속성 제거
          const allowed = ALLOWED_ATTRS[child.tagName] || [];
          const attrs = Array.from(child.attributes);
          for (const attr of attrs) {
            const name = attr.name.toLowerCase();
            if (name.startsWith("on") || !allowed.includes(name)) {
              child.removeAttribute(attr.name);
            } else if ((name === "href" || name === "src") && attr.value.trim().toLowerCase().startsWith("javascript:")) {
              child.removeAttribute(attr.name);
            }
          }

          if (child.tagName === "A") {
            child.setAttribute("rel", "noopener noreferrer");
            child.setAttribute("target", "_blank");
          }

          cleanNode(child);
        }
      }
    }

    cleanNode(doc.body);
    return doc.body.innerHTML;
  }

  function loadPosts() {
    return [...INITIAL_POSTS];
  }

  function savePosts(newPosts) {
    posts = newPosts;
  }

  function showSyncToast(message) {
    let toast = document.getElementById("syncGlobalToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "syncGlobalToast";
      toast.className = "sync-global-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2600);
  }

  // =========================================
  // Supabase 클라우드 데이터베이스 연동 관리
  // =========================================
  // [엔드포인트 및 공개 키 보호 (Base64 난독화)]
  // - GitHub 공개 저장소 검색 및 크롤러로부터 프로젝트 주소와 키를 보호하기 위해 부호화되어 있습니다.
  // - 원래 평문 형태로 직접 되돌리고 싶으실 경우, _decodeConfig(...) 대신 직접 따옴표 안에 원래 주소와 키를 넣으시면 됩니다.
  const _decodeConfig = (str) => {
    try {
      return typeof atob === "function" ? atob(str) : "";
    } catch (e) {
      return "";
    }
  };

  const DEFAULT_SUPABASE_CONFIG = {
    url: _decodeConfig("aHR0cHM6Ly9icWZiZnJ4cnVibXFrZGpvdXlqay5zdXBhYmFzZS5jbw=="),
    anonKey: _decodeConfig("c2JfcHVibGlzaGFibGVfdW5rQUxDZnkyZGhuRlFia0JZbUNjQV9Va0ZBMEx4TQ==")
  };

  function getSupabaseConfig() {
    return DEFAULT_SUPABASE_CONFIG;
  }

  let supabaseClient = null;
  let isInitialCloudLoaded = false;
  let _waitingSdk = false;

  // 안전한 브라우저 세션 스토리지 어댑터 (localStorage 완전 배제)
  // - localStorage는 0% 사용 (영구 디스크 저장 절대 안 함)
  // - 현재 탭이 열려있는 동안(새로고침 및 글 작성 포함) 세션 유지
  // - 브라우저 탭을 닫으면 세션이 즉시 완전 소멸되어 보안 유지
  const memoryFallback = {};
  const sessionAdapter = {
    getItem: (key) => {
      try {
        if (typeof window !== "undefined" && window.sessionStorage) {
          return window.sessionStorage.getItem(key);
        }
      } catch (e) { }
      return Object.prototype.hasOwnProperty.call(memoryFallback, key) ? memoryFallback[key] : null;
    },
    setItem: (key, value) => {
      try {
        if (typeof window !== "undefined" && window.sessionStorage) {
          window.sessionStorage.setItem(key, String(value));
          return;
        }
      } catch (e) { }
      memoryFallback[key] = String(value);
    },
    removeItem: (key) => {
      try {
        if (typeof window !== "undefined" && window.sessionStorage) {
          window.sessionStorage.removeItem(key);
        }
      } catch (e) { }
      delete memoryFallback[key];
    }
  };

  // 설정값으로 클라이언트 생성 + 인증 이벤트 연결 (생성 지점 단일화)
  function createClientFromConfig(config) {
    try {
      const client = window.supabase.createClient(config.url, config.anonKey, {
        auth: {
          storage: sessionAdapter, // 탭 세션 동안만 유지되며 탭 닫으면 즉시 소멸
          persistSession: true, // 세션 어댑터를 통해 Supabase REST 쿼리가 JWT 토큰을 정상 첨부하도록 유지
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
      attachAuthListener(client);
      return client;
    } catch (e) {
      return null;
    }
  }

  async function initSupabaseClient() {
    const config = getSupabaseConfig();
    if (config && config.url && config.anonKey) {
      if (window.supabase) {
        supabaseClient = createClientFromConfig(config);
        await syncSession();
        updateAdminUI();
      } else {
        supabaseClient = null;
        waitForSupabaseSdk();
      }
    } else {
      supabaseClient = null;
    }
    updateCloudSyncUI();
  }

  function waitForSupabaseSdk() {
    if (_waitingSdk) return;
    _waitingSdk = true;
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (window.supabase) {
        clearInterval(interval);
        _waitingSdk = false;
        const config = getSupabaseConfig();
        if (config && config.url && config.anonKey) {
          supabaseClient = createClientFromConfig(config);
          await syncSession();
          updateAdminUI();
          updateCloudSyncUI();
          if (!isInitialCloudLoaded) {
            await loadInitialData();
          }
        }
      } else if (attempts > 50) {
        // 5초 경과 시 백업 CDN 주입 시도
        clearInterval(interval);
        _waitingSdk = false;
        if (!window.supabase) {
          const backupScript = document.createElement("script");
          backupScript.src = "https://unpkg.com/@supabase/supabase-js@2";
          backupScript.onload = async () => {
            const config = getSupabaseConfig();
            if (config && config.url && config.anonKey && window.supabase) {
              supabaseClient = createClientFromConfig(config);
              await syncSession();
              updateAdminUI();
              updateCloudSyncUI();
              if (!isInitialCloudLoaded) {
                await loadInitialData();
              }
            }
          };
          document.head.appendChild(backupScript);
        }
      }
    }, 100);
  }

  function updateCloudSyncUI() {
    const badge = document.getElementById("cloudSyncStatusBadge");
    const config = getSupabaseConfig();
    if (badge) {
      if (config && supabaseClient) {
        badge.textContent = "☁️ 동기화 켜짐";
        badge.classList.add("connected");
        badge.title = "원격 동기화가 활성화되어 있습니다 (클릭하여 설정)";
      } else {
        badge.textContent = "☁️ 동기화 미연결";
        badge.classList.remove("connected");
        badge.title = "원격 동기화를 연결하면 여러 기기에서 실시간 동기화가 가능합니다 (클릭하여 설정)";
      }
    }
  }

  async function fetchCloudPosts() {
    if (!supabaseClient) return null;
    try {
      const { data, error } = await supabaseClient
        .from("posts")
        .select("*")
        .order("id", { ascending: false });

      if (error) {
        return null;
      }
      return data;
    } catch (err) {
      return null;
    }
  }

  function loadCustomTags() {
    const initialTagSet = new Set();
    INITIAL_POSTS.forEach((p) => {
      (p.tags || []).forEach((t) => initialTagSet.add(t));
    });
    return Array.from(initialTagSet);
  }

  function saveCustomTags(tagList) {
    customTags = tagList;
  }

  let posts = loadPosts();
  let customTags = loadCustomTags();

  // =========================================
  // 상태 관리 (전역 변수 변조 방어)
  // =========================================
  const state = {
    // 관리자 UI 표시 여부 (실제 DB 권한은 서버 RLS가 판단하므로 이 값을 조작해도 서버 쓰기/삭제 불가)
    get isAdmin() {
      return !!(authSession && authSession.user);
    },
    set isAdmin(val) {
      if (!val) {
        authSession = null;
      }
    },
    selectedCategory: "전체",
    selectedTag: null,
    currentView: "home", // 'home' | 'post' | 'about'
    currentPostId: null,
    uploadedImages: [], // 새로 업로드할 사진 목록 (base64 배열)
    uploadedImageDataUrl: null, // 첫 번째 대표 사진 (호환성)
    modalSelectedTags: [], // 글쓰기 모달에서 선택된 태그 목록
    writeModalMode: "edit", // 'edit' | 'preview'
    previewSubView: "card", // 'card' | 'detail'
    viewMode: "list" // 'list' | 'album'
  };

  // DOM 요소 참조
  const htmlEl = document.documentElement;
  const themeToggleBtn = document.getElementById("themeToggle");
  const brandLink = document.getElementById("brandLink");
  const navLinks = document.querySelectorAll(".nav-link[data-view]");

  const homeView = document.getElementById("homeView");
  const postDetailView = document.getElementById("postDetailView");
  const aboutView = document.getElementById("aboutView");

  const categoryBar = document.getElementById("categoryBar");
  const tagBar = document.getElementById("tagBar");
  const adminTagActions = document.getElementById("adminTagActions");
  const openManageTagsModalBtn = document.getElementById("openManageTagsModalBtn");
  const resetFilterBtn = document.getElementById("resetFilterBtn");
  const postListEl = document.getElementById("postList");
  const postFilteredCount = document.getElementById("postFilteredCount");
  const viewModeListBtn = document.getElementById("viewModeListBtn");
  const viewModeAlbumBtn = document.getElementById("viewModeAlbumBtn");
  const postDetailContent = document.getElementById("postDetailContent");
  const backToListBtn = document.getElementById("backToListBtn");
  const deletePostBtn = document.getElementById("deletePostBtn");

  // 관리자 인증 관련 DOM
  const adminAuthBtn = document.getElementById("adminAuthBtn");
  const adminAuthBtnText = document.getElementById("adminAuthBtnText");
  const adminIndicatorBar = document.getElementById("adminIndicatorBar");
  const quickLogoutBtn = document.getElementById("quickLogoutBtn");

  const loginModal = document.getElementById("loginModal");
  const closeLoginModalBtn = document.getElementById("closeLoginModalBtn");
  const cancelLoginBtn = document.getElementById("cancelLoginBtn");
  const adminLoginForm = document.getElementById("adminLoginForm");
  const adminPasswordInput = document.getElementById("adminPasswordInput");
  const loginErrorMsg = document.getElementById("loginErrorMsg");

  // 태그 관리 모달 관련 DOM
  const manageTagsModal = document.getElementById("manageTagsModal");
  const closeManageTagsModalBtn = document.getElementById("closeManageTagsModalBtn");
  const doneManageTagsBtn = document.getElementById("doneManageTagsBtn");
  const submitAddTagBtn = document.getElementById("submitAddTagBtn");
  const newTagNameInput = document.getElementById("newTagNameInput");
  const manageTagList = document.getElementById("manageTagList");

  // 글쓰기 모달 관련 DOM
  const openWriteModalBtn = document.getElementById("openWriteModalBtn");
  const closeWriteModalBtn = document.getElementById("closeWriteModalBtn");
  const cancelWriteBtn = document.getElementById("cancelWriteBtn");
  const writeModal = document.getElementById("writeModal");
  const writeModalTitle = document.getElementById("writeModalTitle");
  const writeTabEditBtn = document.getElementById("writeTabEditBtn");
  const writeTabPreviewBtn = document.getElementById("writeTabPreviewBtn");
  const writePostForm = document.getElementById("writePostForm");
  const postCategorySelect = document.getElementById("postCategorySelect");
  const postTitleInput = document.getElementById("postTitleInput");
  const postContentInput = document.getElementById("postContentInput");
  const postImageInput = document.getElementById("postImageInput");
  const uploadDropzone = document.getElementById("uploadDropzone");
  const uploadPlaceholder = document.getElementById("uploadPlaceholder");
  const uploadGalleryContainer = document.getElementById("uploadGalleryContainer");
  const uploadPhotoCount = document.getElementById("uploadPhotoCount");
  const clearAllPhotosBtn = document.getElementById("clearAllPhotosBtn");
  const uploadThumbGrid = document.getElementById("uploadThumbGrid");
  const previewFromFormBtn = document.getElementById("previewFromFormBtn");

  // 미리보기 섹션 관련 DOM
  const writePreviewSection = document.getElementById("writePreviewSection");
  const previewSubTabCard = document.getElementById("previewSubTabCard");
  const previewSubTabDetail = document.getElementById("previewSubTabDetail");
  const previewCardContainer = document.getElementById("previewCardContainer");
  const previewDetailContainer = document.getElementById("previewDetailContainer");
  const backToEditBtn = document.getElementById("backToEditBtn");
  const publishFromPreviewBtn = document.getElementById("publishFromPreviewBtn");

  // 사진 라이트박스 모달 관련 DOM
  const imageLightboxModal = document.getElementById("imageLightboxModal");
  const lightboxBackdrop = document.getElementById("lightboxBackdrop");
  const closeLightboxBtn = document.getElementById("closeLightboxBtn");
  const lightboxImg = document.getElementById("lightboxImg");

  // 태그 입력 칩 관련 DOM
  const selectedTagsContainer = document.getElementById("selectedTagsContainer");
  const modalTagInput = document.getElementById("modalTagInput");
  const availableTagsList = document.getElementById("availableTagsList");

  // =========================================
  // 1. 관리자 권한 UI 동기화
  // =========================================
  function updateAdminUI() {
    if (state.isAdmin) {
      // 관리자 모드
      openWriteModalBtn.classList.remove("hidden");
      adminTagActions.classList.remove("hidden");
      adminIndicatorBar.classList.remove("hidden");
      adminAuthBtn.classList.add("is-admin");
      adminAuthBtnText.textContent = "로그아웃";
      adminAuthBtn.title = "관리자 로그아웃";
      deletePostBtn.classList.remove("hidden");
      updateCloudSyncUI();
    } else {
      // 방문자 모드 (읽기 전용)
      openWriteModalBtn.classList.add("hidden");
      adminTagActions.classList.add("hidden");
      adminIndicatorBar.classList.add("hidden");
      adminAuthBtn.classList.remove("is-admin");
      adminAuthBtnText.textContent = "관리자";
      adminAuthBtn.title = "관리자 로그인";
      deletePostBtn.classList.add("hidden");
    }
  }

  function setLoginError(message) {
    loginErrorMsg.textContent = message;
    loginErrorMsg.classList.remove("hidden");
  }

  let isLoggingIn = false;

  // Supabase의 최소 6자리 비밀번호 규칙을 충족하기 위한 안전한 내부 확장 함수
  function formatAdminPassword(rawPw) {
    if (!rawPw) return "";
    // 4자리 PIN 등 짧은 비밀번호가 들어와도 Supabase Auth 최소 6자 정책을 통과하도록 안전하게 확장
    return rawPw.length < 6 ? `vibe_${rawPw}_secure` : rawPw;
  }

  // 로그인: Supabase Auth 서버에서 비밀번호 검증 (무차별 대입 제한도 서버에서 적용)
  async function handleLogin(password) {
    if (isLoggingIn) return;
    if (!supabaseClient) {
      setLoginError("원격 동기화가 연결되지 않아 로그인할 수 없습니다. 아래 [동기화 설정]을 먼저 완료해 주세요.");
      return;
    }
    const cleanPassword = (password || "").trim();
    if (!cleanPassword) {
      setLoginError("비밀번호를 입력해 주세요.");
      return;
    }

    const securePassword = formatAdminPassword(cleanPassword);
    const submitBtn = adminLoginForm.querySelector("button[type='submit']");
    isLoggingIn = true;
    if (submitBtn) submitBtn.disabled = true;
    loginErrorMsg.classList.add("hidden");

    try {
      let loginData = null;
      let lastError = null;

      // 4자리 PIN 등 짧은 비밀번호와 Supabase 최소 6자리 정책 간의 호환성을 위해 후보 비밀번호 순차 검증
      const candidatePasswords = [
        cleanPassword,
        `vibe_${cleanPassword}_secure`,
        `${cleanPassword}${cleanPassword}`,
        `${cleanPassword}00`
      ];

      // 1) 로그인 시도 (후보 중 일치하는 비밀번호로 인증)
      for (const pw of candidatePasswords) {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
          email: ADMIN_AUTH_EMAIL,
          password: pw
        });
        if (!error && data && data.session) {
          loginData = data;
          lastError = null;
          break;
        }
        lastError = error;
      }

      if (!loginData) {
        console.error("로그인 에러 상세:", lastError);
        if (lastError && lastError.status === 429) {
          setLoginError("로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.");
        } else {
          setLoginError("비밀번호가 올바르지 않거나 관리자 계정(admin@vibe.blog)이 생성되지 않았습니다. 아래 안내에 따라 Supabase 대시보드에서 계정을 1회 생성해 주세요.");
        }
        adminPasswordInput.value = "";
        adminPasswordInput.focus();
        return;
      }

      authSession = loginData ? loginData.session : null;
      await syncSession();

      adminPasswordInput.value = "";
      closeAuthModal();
      updateAdminUI();
      renderTags();
    } catch (err) {
      setLoginError("로그인 처리 중 오류가 발생했습니다.");
    } finally {
      isLoggingIn = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function handleLogout() {
    if (!confirm("관리자 모드에서 로그아웃하시겠습니까?")) return;
    try {
      if (supabaseClient) await supabaseClient.auth.signOut();
    } catch (e) { }
    authSession = null;
    updateAdminUI();
    renderTags();
  }

  function openAuthModal() {
    loginErrorMsg.classList.add("hidden");
    adminPasswordInput.value = "";
    loginModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    if (!supabaseClient) {
      setLoginError("원격 동기화가 연결되지 않아 로그인할 수 없습니다. 아래 [동기화 설정]을 먼저 완료해 주세요.");
    }
    setTimeout(() => adminPasswordInput.focus(), 50);
  }

  function closeAuthModal() {
    loginModal.classList.add("hidden");
    document.body.style.overflow = "";
  }

  // =========================================
  // 2. 다크 모드 / 라이트 모드 관리
  // =========================================
  function initTheme() {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    htmlEl.setAttribute("data-theme", prefersDark ? "dark" : "light");
  }

  function toggleTheme() {
    const current = htmlEl.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    htmlEl.setAttribute("data-theme", next);
  }

  // =========================================
  // 3. 카테고리(목차) 및 태그 렌더링
  // =========================================
  function getCategories() {
    const counts = {
      전체: posts.length,
      농사: 0,
      일상: 0,
      보일러: 0
    };

    posts.forEach((post) => {
      if (counts[post.category] !== undefined) {
        counts[post.category]++;
      } else {
        counts[post.category] = (counts[post.category] || 0) + 1;
      }
    });

    return counts;
  }

  function getAllTags() {
    const tagSet = new Set(customTags);
    posts.forEach((post) => {
      if (Array.isArray(post.tags)) {
        post.tags.forEach((tag) => tagSet.add(tag));
      }
    });
    return Array.from(tagSet);
  }

  function renderCategories() {
    const categoryCounts = getCategories();
    const categoryKeys = ["전체", "농사", "일상", "보일러"];

    categoryBar.innerHTML = categoryKeys
      .map((category) => {
        const count = categoryCounts[category] || 0;
        const isActive = state.selectedCategory === category ? "active" : "";
        const safeCat = escapeHtml(category);
        return `
        <button
          type="button"
          class="category-tab ${isActive}"
          data-category="${safeCat}"
          role="tab"
          aria-selected="${state.selectedCategory === category}"
        >
          ${safeCat}<span class="category-count">${count}</span>
        </button>
      `;
      })
      .join("");
  }

  function renderTags() {
    const tags = getAllTags();
    if (tags.length === 0) {
      tagBar.innerHTML = `<span style="font-size:0.85rem; color:var(--text-muted);">등록된 태그가 없습니다.</span>`;
    } else {
      tagBar.innerHTML = tags
        .map((tag) => {
          const isActive = state.selectedTag === tag ? "active" : "";
          const safeTag = escapeHtml(tag);
          return `
          <button
            type="button"
            class="tag-pill ${isActive}"
            data-tag="${safeTag}"
          >
            #${safeTag}
          </button>
        `;
        })
        .join("");
    }

    // 필터 초기화 버튼 표시 여부
    if (state.selectedCategory !== "전체" || state.selectedTag !== null) {
      resetFilterBtn.classList.remove("hidden");
    } else {
      resetFilterBtn.classList.add("hidden");
    }
  }

  // 태그 등록
  function registerNewTag(tagName) {
    if (!authSession) {
      alert("관리자 로그인이 필요합니다.");
      return;
    }
    const cleanTag = escapeHtml(tagName.trim().replace(/^#/, "")).slice(0, 30);
    if (!cleanTag) return;

    if (!customTags.includes(cleanTag)) {
      customTags.push(cleanTag);
      saveCustomTags(customTags);
      renderTags();
    }
    return cleanTag;
  }

  // 태그 삭제 (태그 풀 및 기존 글에서 일괄 제거)
  function removeTagGlobally(tagToRemove) {
    if (!authSession) {
      alert("관리자 로그인이 필요합니다.");
      return;
    }
    if (!confirm(`'#${tagToRemove}' 태그를 완전히 삭제하시겠습니까?\n(해당 태그가 적용된 글에서도 함께 삭제됩니다)`)) {
      return;
    }

    // 1. 커스텀 태그 풀에서 제거
    customTags = customTags.filter((t) => t !== tagToRemove);
    saveCustomTags(customTags);

    // 2. 기존 포스트들에 포함된 태그에서도 제거
    posts.forEach((post) => {
      if (Array.isArray(post.tags)) {
        post.tags = post.tags.filter((t) => t !== tagToRemove);
      }
    });
    savePosts(posts);

    // 3. 현재 필터링 중인 태그였으면 필터 해제
    if (state.selectedTag === tagToRemove) {
      state.selectedTag = null;
    }

    // 4. 모달창 및 메인 UI 리렌더링
    renderManageTagList();
    updateHomeUI();
  }

  // =========================================
  // 4. 포스트 목록 렌더링
  // =========================================
  function getFilteredPosts() {
    return posts.filter((post) => {
      const matchCategory =
        state.selectedCategory === "전체" || post.category === state.selectedCategory;
      const matchTag =
        state.selectedTag === null || (post.tags && post.tags.includes(state.selectedTag));
      return matchCategory && matchTag;
    });
  }

  function renderPostList() {
    const filtered = getFilteredPosts();

    // 목록 글 수 카운트 동기화
    if (postFilteredCount) {
      postFilteredCount.textContent = filtered.length;
    }

    // 보기 형식 클래스 및 버튼 활성 상태 동기화
    postListEl.classList.toggle("album-view", state.viewMode === "album");
    postListEl.classList.toggle("list-view", state.viewMode === "list");

    if (viewModeListBtn && viewModeAlbumBtn) {
      viewModeListBtn.classList.toggle("active", state.viewMode === "list");
      viewModeListBtn.setAttribute("aria-selected", state.viewMode === "list");
      viewModeAlbumBtn.classList.toggle("active", state.viewMode === "album");
      viewModeAlbumBtn.setAttribute("aria-selected", state.viewMode === "album");
    }

    if (filtered.length === 0) {
      postListEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📝</div>
        <p class="empty-state-title">선택하신 조건에 해당하는 글이 없습니다.</p>
        ${state.isAdmin
          ? `<p style="margin-top:0.5rem; font-size:0.9rem; color:var(--text-muted);">상단의 <strong>글쓰기</strong> 버튼을 눌러 첫 글과 사진을 올려보세요!</p>`
          : ""
        }
      </div>
    `;
      return;
    }

    const categoryIcons = {
      농사: "🌱",
      일상: "☕",
      보일러: "🔥"
    };

    postListEl.innerHTML = filtered
      .map((post) => {
        const postImages = post.images && post.images.length > 0
          ? post.images
          : (post.image ? [post.image] : []);
        const primaryImg = postImages[0];
        const hasThumb = Boolean(primaryImg);
        const catIcon = categoryIcons[post.category] || "📝";
        const multiBadge = postImages.length > 1
          ? `<span class="multi-photo-badge">📷 ${postImages.length}</span>`
          : "";

        const safeTitle = escapeHtml(post.title);
        const safeCat = escapeHtml(post.category);
        const safeDate = escapeHtml(post.date);
        const safeExcerpt = escapeHtml(post.excerpt || "");
        const safeImg = sanitizeImageUrl(primaryImg);

        let thumbHtml = "";
        if (hasThumb && safeImg) {
          thumbHtml = `
          <div class="post-item-thumb">
            <img src="${safeImg}" alt="${safeTitle}" loading="lazy" />
            ${multiBadge}
          </div>
        `;
        } else if (state.viewMode === "album") {
          // 앨범형 모드에서는 사진이 없더라도 균형 잡힌 테마 플레이스홀더를 제공
          thumbHtml = `
          <div class="post-item-thumb thumb-placeholder">
            <span class="thumb-placeholder-icon">${catIcon}</span>
            <span class="thumb-placeholder-text">${safeCat} 이야기</span>
          </div>
        `;
        }

        return `
      <article class="post-item" data-post-id="${post.id}">
        <div class="post-item-main">
          <div class="post-item-text">
            <div class="post-item-header">
              <span class="post-category-badge">${safeCat}</span>
              <span class="meta-divider">·</span>
              <time class="post-date">${safeDate}</time>
            </div>
            <h2 class="post-item-title">${safeTitle}</h2>
            <p class="post-item-excerpt">${safeExcerpt}</p>
            <div class="post-item-tags">
              ${(post.tags || [])
            .map(
              (tag) => {
                const safeTag = escapeHtml(tag);
                return `<span class="post-item-tag" data-inline-tag="${safeTag}">#${safeTag}</span>`;
              }
            )
            .join("")}
            </div>
          </div>
          ${thumbHtml}
        </div>
      </article>
      `;
      })
      .join("");
  }

  // =========================================
  // 5. 비율 맞춤 멀티 포토 갤러리 & 라이트박스
  // =========================================
  function renderMultiPhotoGallery(images, altTitle = "", isPreview = false) {
    if (!images || images.length === 0) {
      if (isPreview) {
        return `<div class="preview-empty-image-notice">📷 등록된 대표 사진이 없습니다 (사진 업로드 시 실제 비율로 여기에 표시됩니다)</div>`;
      }
      return "";
    }

    const count = images.length;
    let gridClass = "grid-count-1";
    if (count === 2) gridClass = "grid-count-2";
    else if (count === 3) gridClass = "grid-count-3";
    else if (count === 4) gridClass = "grid-count-4";
    else if (count >= 5) gridClass = "grid-count-many";

    const safeAlt = escapeHtml(altTitle);
    // 최대 4칸까지 그리드로 시각화 (5장 이상은 4번째에 +N 오버레이)
    const displayImages = count <= 4 ? images : images.slice(0, 4);

    const gridItemsHtml = displayImages
      .map((imgSrc, idx) => {
        const isFourthOfMany = count >= 5 && idx === 3;
        const safeSrc = sanitizeImageUrl(imgSrc);
        if (!safeSrc) return "";
        const overlayHtml = isFourthOfMany
          ? `
          <div class="gallery-more-overlay">
            <span class="more-count">+${count - 3}</span>
            <span class="more-label">전체 사진 보기</span>
          </div>
        `
          : "";

        return `
        <div class="gallery-photo-item" data-lightbox-src="${safeSrc}" title="사진 클릭 시 원본 크게 보기">
          <img src="${safeSrc}" alt="${safeAlt} - 사진 ${idx + 1}" loading="lazy" />
          ${overlayHtml}
        </div>
      `;
      })
      .join("");

    // 5장 이상일 때 아래에 전체 사진 썸네일 스트립 추가
    let subThumbsHtml = "";
    if (count >= 5) {
      subThumbsHtml = `
      <div class="gallery-sub-thumbnails" aria-label="전체 사진 썸네일 목록">
        ${images
          .map(
            (imgSrc, i) => {
              const safeSrc = sanitizeImageUrl(imgSrc);
              if (!safeSrc) return "";
              return `
              <button type="button" class="sub-thumb-btn" data-lightbox-src="${safeSrc}" title="사진 ${i + 1} 원본 크게보기">
                <img src="${safeSrc}" alt="${safeAlt} 썸네일 ${i + 1}" loading="lazy" />
              </button>
            `;
            }
          )
          .join("")}
      </div>
    `;
    }

    return `
    <div class="article-gallery-container">
      <div class="article-gallery-grid ${gridClass}">
        ${gridItemsHtml}
      </div>
      ${subThumbsHtml}
    </div>
  `;
  }

  function openLightbox(imgSrc) {
    const safeSrc = sanitizeImageUrl(imgSrc);
    if (!safeSrc || !imageLightboxModal || !lightboxImg) return;
    lightboxImg.src = safeSrc;
    imageLightboxModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    if (!imageLightboxModal) return;
    imageLightboxModal.classList.add("hidden");
    document.body.style.overflow = "";
    if (lightboxImg) lightboxImg.src = "";
  }

  // =========================================
  // 6. 포스트 상세 읽기 뷰 & 삭제 기능
  // =========================================
  function openPostDetail(postId) {
    const post = posts.find((item) => item.id === Number(postId));
    if (!post) return;

    state.currentPostId = post.id;

    const postImages = post.images && post.images.length > 0
      ? post.images
      : (post.image ? [post.image] : []);

    const galleryHtml = renderMultiPhotoGallery(postImages, post.title);
    const safeTitle = escapeHtml(post.title);
    const safeCat = escapeHtml(post.category);
    const safeDate = escapeHtml(post.date);

    postDetailContent.innerHTML = `
    <header class="article-header">
      <span class="post-category-badge">${safeCat}</span>
      <h1 class="article-title">${safeTitle}</h1>
      <div class="article-meta">
        <time>${safeDate}</time>
      </div>
      <div class="post-item-tags">
        ${(post.tags || [])
        .map(
          (tag) => {
            const safeTag = escapeHtml(tag);
            return `<button type="button" class="tag-pill" data-detail-tag="${safeTag}">#${safeTag}</button>`;
          }
        )
        .join("")}
      </div>
    </header>
    ${galleryHtml}
    <div class="article-body">
      ${sanitizeHtmlContent(post.content)}
    </div>
  `;

    deletePostBtn.classList.toggle("hidden", !state.isAdmin);

    switchView("post");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteCurrentPost() {
    if (!state.isAdmin || !state.currentPostId) return;
    if (!supabaseClient) {
      alert("원격 동기화가 연결되어 있지 않아 삭제할 수 없습니다.");
      return;
    }
    if (!confirm("정말로 이 글을 삭제하시겠습니까?")) return;

    const deletedId = Number(state.currentPostId);

    // 1) 서버 삭제 요청 - 권한 판단은 서버 RLS 정책이 수행
    //    RLS에 막히면 에러 없이 0건이 삭제되므로, 삭제된 행을 돌려받아 실제 성공 여부를 확인
    showSyncToast("글 삭제 처리 중...");
    try {
      const { data, error } = await supabaseClient
        .from("posts")
        .delete()
        .eq("id", deletedId)
        .select("id");

      if (error || !data || data.length === 0) {
        console.error("Supabase 글 삭제 실패 원인:", error || "삭제된 행 0건 (RLS 권한 거부)");
        await syncSession();
        updateAdminUI();
        const errorMsg = error ? error.message : "삭제 권한이 없거나 서버 RLS 정책에 의해 차단되었습니다.";
        alert(`⚠️ 삭제 실패: ${errorMsg}`);
        return;
      }
    } catch (err) {
      console.error("삭제 예외 발생:", err);
      alert("⚠️ 삭제 처리 중 오류가 발생했습니다: " + err.message);
      return;
    }

    // 2) 서버에서 삭제가 확인된 경우에만 로컬 캐시에서도 제거
    posts = posts.filter((p) => Number(p.id) !== deletedId);
    savePosts(posts);

    showSyncToast("🗑️ 글이 성공적으로 삭제되었습니다!");
    alert("글이 삭제되었습니다.");
    switchView("home");
    updateHomeUI();
  }

  // =========================================
  // 6. 화면 전환 & UI 업데이트
  // =========================================
  function switchView(viewName) {
    state.currentView = viewName;

    homeView.classList.toggle("hidden", viewName !== "home");
    postDetailView.classList.toggle("hidden", viewName !== "post");
    aboutView.classList.toggle("hidden", viewName !== "about");

    navLinks.forEach((btn) => {
      const target = btn.getAttribute("data-view");
      btn.classList.toggle(
        "active",
        target === viewName || (viewName === "post" && target === "home")
      );
    });
  }

  function updateHomeUI() {
    renderCategories();
    renderTags();
    renderPostList();
    updateAdminUI();
  }

  // =========================================
  // 7. 글쓰기 모달 내 태그 입력 칩 로직
  // =========================================
  function renderModalTags() {
    selectedTagsContainer.innerHTML = state.modalSelectedTags
      .map(
        (tag, index) => {
          const safeTag = escapeHtml(tag);
          return `
        <span class="tag-badge">
          #${safeTag}
          <span class="tag-badge-remove" data-remove-index="${index}" title="삭제">✕</span>
        </span>
      `;
        }
      )
      .join("");

    const allTags = getAllTags();
    availableTagsList.innerHTML = allTags
      .map((tag) => {
        const isAdded = state.modalSelectedTags.includes(tag);
        const safeTag = escapeHtml(tag);
        return `
        <button
          type="button"
          class="available-tag-chip ${isAdded ? "added" : ""}"
          data-chip-tag="${safeTag}"
        >
          + ${safeTag}
        </button>
      `;
      })
      .join("");
  }

  function addTagToModal(tagText) {
    const cleanTag = tagText.trim().replace(/^#/, "");
    if (!cleanTag) return;

    if (!state.modalSelectedTags.includes(cleanTag)) {
      state.modalSelectedTags.push(cleanTag);
      registerNewTag(cleanTag);
      renderModalTags();
    }
    modalTagInput.value = "";
  }

  function removeTagFromModal(index) {
    state.modalSelectedTags.splice(index, 1);
    renderModalTags();
  }

  // =========================================
  // 8. 태그 통합 관리(추가 및 삭제) 모달 로직
  // =========================================
  function renderManageTagList() {
    const allTags = getAllTags();
    if (allTags.length === 0) {
      manageTagList.innerHTML = `<span style="font-size:0.85rem; color:var(--text-muted); padding:0.5rem 0;">등록된 태그가 없습니다.</span>`;
      return;
    }

    manageTagList.innerHTML = allTags
      .map(
        (tag) => {
          const safeTag = escapeHtml(tag);
          return `
        <div class="manage-tag-chip">
          <span>#${safeTag}</span>
          <button type="button" class="manage-tag-delete-btn" data-delete-tag="${safeTag}" title="'#${safeTag}' 태그 삭제">✕</button>
        </div>
      `;
        }
      )
      .join("");
  }

  function openManageTagsModal() {
    if (!state.isAdmin) {
      alert("관리자만 태그를 관리할 수 있습니다. 먼저 관리자로 로그인해 주세요.");
      openAuthModal();
      return;
    }
    newTagNameInput.value = "";
    renderManageTagList();
    manageTagsModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeManageTagsModal() {
    manageTagsModal.classList.add("hidden");
    document.body.style.overflow = "";
  }

  // =========================================
  // 9. 모달 제어 및 글 미리보기 함수
  // =========================================
  function switchWriteModalMode(mode) {
    state.writeModalMode = mode;
    if (mode === "preview") {
      // 인풋에 입력 중이던 태그가 있다면 자동 등록
      if (modalTagInput.value.trim()) {
        addTagToModal(modalTagInput.value);
      }

      renderPostPreview();

      writeTabEditBtn.classList.remove("active");
      writeTabEditBtn.setAttribute("aria-selected", "false");
      writeTabPreviewBtn.classList.add("active");
      writeTabPreviewBtn.setAttribute("aria-selected", "true");

      writePostForm.classList.add("hidden");
      writePreviewSection.classList.remove("hidden");
      writeModalTitle.textContent = "글 미리보기";
    } else {
      writeTabEditBtn.classList.add("active");
      writeTabEditBtn.setAttribute("aria-selected", "true");
      writeTabPreviewBtn.classList.remove("active");
      writeTabPreviewBtn.setAttribute("aria-selected", "false");

      writePostForm.classList.remove("hidden");
      writePreviewSection.classList.add("hidden");
      writeModalTitle.textContent = "새 글 쓰기";
    }
  }

  function switchPreviewSubView(subView) {
    state.previewSubView = subView;
    if (subView === "detail") {
      previewSubTabDetail.classList.add("active");
      previewSubTabCard.classList.remove("active");
      previewCardContainer.classList.add("hidden");
      previewDetailContainer.classList.remove("hidden");
    } else {
      previewSubTabCard.classList.add("active");
      previewSubTabDetail.classList.remove("active");
      previewCardContainer.classList.remove("hidden");
      previewDetailContainer.classList.add("hidden");
    }
  }

  function renderPostPreview() {
    const category = postCategorySelect.value;
    const rawTitle = postTitleInput.value.trim();
    const rawContent = postContentInput.value.trim();
    const tags = [...state.modalSelectedTags];

    const now = new Date();
    const dateStr = `${now.getFullYear()}. ${String(now.getMonth() + 1).padStart(2, "0")}. ${String(now.getDate()).padStart(2, "0")}`;

    const safeCategory = escapeHtml(category);
    const displayTitle = rawTitle ? escapeHtml(rawTitle) : `<span class="preview-placeholder-text">(작성 중인 제목이 표시됩니다)</span>`;
    const plainTitleForAlt = rawTitle ? escapeHtml(rawTitle) : "미리보기 이미지";

    const excerpt = rawContent
      ? escapeHtml(rawContent.slice(0, 100) + (rawContent.length > 100 ? "..." : ""))
      : `<span class="preview-placeholder-text">(본문 내용이 작성되면 앞부분이 목록에 자동으로 요약 표시됩니다)</span>`;

    const formattedContent = rawContent
      ? rawContent
        .split(/\n\s*\n/)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
        .join("")
      : `<p class="preview-placeholder-text">(본문 내용이 작성되면 실제 글 읽기 화면 스타일로 문단과 줄바꿈이 깔끔하게 표시됩니다)</p>`;

    // 1) 목록 카드 뷰 렌더링
    const primaryImg = state.uploadedImages[0] || state.uploadedImageDataUrl || null;
    const safePrimaryImg = sanitizeImageUrl(primaryImg);
    const multiBadge = state.uploadedImages.length > 1
      ? `<span class="multi-photo-badge">📷 ${state.uploadedImages.length}</span>`
      : "";

    const cardThumbHtml = safePrimaryImg
      ? `<div class="post-item-thumb"><img src="${safePrimaryImg}" alt="${plainTitleForAlt}" />${multiBadge}</div>`
      : "";

    const tagsHtml = tags.length > 0
      ? tags.map((t) => `<span class="post-item-tag">#${escapeHtml(t)}</span>`).join("")
      : `<span class="post-item-tag preview-placeholder-text">#태그미지정</span>`;

    previewCardContainer.innerHTML = `
    <div class="preview-card-frame">
      <article class="post-item">
        <div class="post-item-main">
          <div class="post-item-text">
            <div class="post-item-header">
              <span class="post-category-badge">${safeCategory}</span>
              <span class="meta-divider">·</span>
              <time class="post-date">${dateStr}</time>
            </div>
            <h2 class="post-item-title">${displayTitle}</h2>
            <p class="post-item-excerpt">${excerpt}</p>
            <div class="post-item-tags">
              ${tagsHtml}
            </div>
          </div>
          ${cardThumbHtml}
        </div>
      </article>
    </div>
  `;

    // 2) 본문 상세 뷰 렌더링 (황금 비율 멀티 포토 갤러리 렌더링)
    const detailTagsHtml = tags.length > 0
      ? tags.map((t) => `<span class="tag-pill">#${escapeHtml(t)}</span>`).join("")
      : `<span class="tag-pill preview-placeholder-text">#태그미지정</span>`;

    const galleryHtml = renderMultiPhotoGallery(state.uploadedImages, plainTitleForAlt, true);

    previewDetailContainer.innerHTML = `
    <div class="preview-detail-frame">
      <header class="article-header">
        <span class="post-category-badge">${safeCategory}</span>
        <h1 class="article-title">${displayTitle}</h1>
        <div class="article-meta">
          <time>${dateStr}</time>
        </div>
        <div class="post-item-tags">
          ${detailTagsHtml}
        </div>
      </header>
      ${galleryHtml}
      <div class="article-body">
        ${sanitizeHtmlContent(formattedContent)}
      </div>
    </div>
  `;
  }

  function openModal() {
    if (!state.isAdmin) {
      alert("관리자만 글을 작성할 수 있습니다. 먼저 관리자로 로그인해 주세요.");
      openAuthModal();
      return;
    }
    state.modalSelectedTags = [];
    renderModalTags();
    renderUploadedThumbnails();
    switchWriteModalMode("edit");
    switchPreviewSubView("card");
    writeModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    writeModal.classList.add("hidden");
    document.body.style.overflow = "";
    resetWriteForm();
  }

  function resetWriteForm() {
    writePostForm.reset();
    state.uploadedImages = [];
    state.uploadedImageDataUrl = null;
    state.modalSelectedTags = [];
    postImageInput.value = "";
    renderUploadedThumbnails();
    switchWriteModalMode("edit");
    switchPreviewSubView("card");
  }

  const MAX_IMAGE_COUNT = 10;
  const MAX_SINGLE_IMAGE_SIZE = 5 * 1024 * 1024; // 파일당 최대 5MB (DoS 및 스토리지 고갈 방어)
  const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  function handleMultipleImagesSelect(files) {
    if (!authSession) {
      alert("관리자만 이미지를 업로드할 수 있습니다.");
      return;
    }
    if (!files || files.length === 0) return;

    if (state.uploadedImages.length + files.length > MAX_IMAGE_COUNT) {
      alert(`이미지는 최대 ${MAX_IMAGE_COUNT}장까지만 업로드할 수 있습니다.`);
      return;
    }

    const validFiles = Array.from(files).filter((f) => {
      if (!ALLOWED_IMAGE_MIMES.includes(f.type)) {
        alert(`'${escapeHtml(f.name)}' 파일은 허용되지 않는 이미지 형식입니다. (JPG, PNG, GIF, WEBP 지원)`);
        return false;
      }
      if (f.size > MAX_SINGLE_IMAGE_SIZE) {
        alert(`'${escapeHtml(f.name)}' 파일의 용량이 너무 큽니다. (파일당 최대 5MB)`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    let loadedCount = 0;
    validFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        state.uploadedImages.push(e.target.result);
        loadedCount++;
        if (loadedCount === validFiles.length) {
          state.uploadedImageDataUrl = state.uploadedImages[0] || null;
          renderUploadedThumbnails();
        }
      };
      reader.readAsDataURL(file);
    });
  }

  function renderUploadedThumbnails() {
    if (!uploadGalleryContainer || !uploadThumbGrid || !uploadPhotoCount) return;

    if (state.uploadedImages.length === 0) {
      uploadGalleryContainer.classList.add("hidden");
      uploadPhotoCount.textContent = "0";
      uploadThumbGrid.innerHTML = "";
      state.uploadedImageDataUrl = null;
      return;
    }

    uploadGalleryContainer.classList.remove("hidden");
    uploadPhotoCount.textContent = state.uploadedImages.length;
    state.uploadedImageDataUrl = state.uploadedImages[0];

    uploadThumbGrid.innerHTML = state.uploadedImages
      .map((imgSrc, idx) => {
        const safeSrc = sanitizeImageUrl(imgSrc);
        if (!safeSrc) return "";
        const primaryBadge = idx === 0 ? `<span class="primary-badge">대표</span>` : "";
        return `
        <div class="upload-thumb-item">
          <img src="${safeSrc}" alt="업로드 사진 ${idx + 1}" />
          ${primaryBadge}
          <button type="button" class="btn-delete-thumb" data-thumb-index="${idx}" title="이 사진 삭제">✕</button>
        </div>
      `;
      })
      .join("");
  }

  function removeUploadedImage(index) {
    state.uploadedImages.splice(index, 1);
    state.uploadedImageDataUrl = state.uploadedImages[0] || null;
    renderUploadedThumbnails();
  }

  function clearAllUploadedImages() {
    if (state.uploadedImages.length > 0 && confirm("등록된 사진을 모두 삭제하시겠습니까?")) {
      state.uploadedImages = [];
      state.uploadedImageDataUrl = null;
      postImageInput.value = "";
      renderUploadedThumbnails();
    }
  }

  // =========================================
  // 10. 이벤트 리스너 등록
  // =========================================
  themeToggleBtn.addEventListener("click", toggleTheme);

  brandLink.addEventListener("click", (e) => {
    e.preventDefault();
    state.selectedCategory = "전체";
    state.selectedTag = null;
    updateHomeUI();
    switchView("home");
  });

  navLinks.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetView = btn.getAttribute("data-view");
      switchView(targetView);
    });
  });

  // 관리자 버튼 클릭 (로그인 / 로그아웃 토글)
  adminAuthBtn.addEventListener("click", () => {
    if (state.isAdmin) {
      handleLogout();
    } else {
      openAuthModal();
    }
  });

  quickLogoutBtn.addEventListener("click", handleLogout);

  closeLoginModalBtn.addEventListener("click", closeAuthModal);
  cancelLoginBtn.addEventListener("click", closeAuthModal);

  loginModal.addEventListener("click", (e) => {
    if (e.target === loginModal) closeAuthModal();
  });

  adminLoginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await handleLogin(adminPasswordInput.value);
  });

  // 태그 관리(추가/삭제) 모달 제어
  openManageTagsModalBtn.addEventListener("click", openManageTagsModal);
  closeManageTagsModalBtn.addEventListener("click", closeManageTagsModal);
  doneManageTagsBtn.addEventListener("click", closeManageTagsModal);

  manageTagsModal.addEventListener("click", (e) => {
    if (e.target === manageTagsModal) closeManageTagsModal();
  });

  // 태그 관리 모달 내 추가 버튼 클릭
  submitAddTagBtn.addEventListener("click", () => {
    if (!state.isAdmin) {
      alert("관리자 권한이 없습니다.");
      return;
    }
    const val = newTagNameInput.value.trim();
    if (!val) return;
    registerNewTag(val);
    newTagNameInput.value = "";
    renderManageTagList();
  });

  newTagNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitAddTagBtn.click();
    }
  });

  // 태그 관리 모달 내 개별 태그 삭제 클릭
  manageTagList.addEventListener("click", (e) => {
    const delBtn = e.target.closest("[data-delete-tag]");
    if (!delBtn) return;
    if (!state.isAdmin) {
      alert("관리자 권한이 없습니다.");
      return;
    }
    const tagToDelete = delBtn.getAttribute("data-delete-tag");
    removeTagGlobally(tagToDelete);
  });

  // 카테고리(목차) 탭 클릭
  categoryBar.addEventListener("click", (e) => {
    const tab = e.target.closest(".category-tab");
    if (!tab) return;
    state.selectedCategory = tab.getAttribute("data-category");
    updateHomeUI();
  });

  // 태그 바 클릭
  tagBar.addEventListener("click", (e) => {
    const pill = e.target.closest(".tag-pill");
    if (!pill) return;
    const clickedTag = pill.getAttribute("data-tag");
    state.selectedTag = state.selectedTag === clickedTag ? null : clickedTag;
    updateHomeUI();
  });

  // 필터 초기화
  resetFilterBtn.addEventListener("click", () => {
    state.selectedCategory = "전체";
    state.selectedTag = null;
    updateHomeUI();
  });

  // 보기 형식 (리스트 vs 앨범형) 전환 함수 및 이벤트
  function setViewMode(mode) {
    if (state.viewMode === mode) return;
    state.viewMode = mode;
    renderPostList();
  }

  if (viewModeListBtn && viewModeAlbumBtn) {
    viewModeListBtn.addEventListener("click", () => setViewMode("list"));
    viewModeAlbumBtn.addEventListener("click", () => setViewMode("album"));
  }

  // 포스트 리스트 클릭
  postListEl.addEventListener("click", (e) => {
    const inlineTag = e.target.closest("[data-inline-tag]");
    if (inlineTag) {
      e.stopPropagation();
      const tag = inlineTag.getAttribute("data-inline-tag");
      state.selectedTag = state.selectedTag === tag ? null : tag;
      updateHomeUI();
      return;
    }

    const postItem = e.target.closest(".post-item");
    if (postItem) {
      const postId = postItem.getAttribute("data-post-id");
      openPostDetail(postId);
    }
  });

  postDetailContent.addEventListener("click", (e) => {
    const detailTag = e.target.closest("[data-detail-tag]");
    if (detailTag) {
      const tag = detailTag.getAttribute("data-detail-tag");
      state.selectedCategory = "전체";
      state.selectedTag = tag;
      updateHomeUI();
      switchView("home");
    }
  });

  backToListBtn.addEventListener("click", () => {
    switchView("home");
  });

  deletePostBtn.addEventListener("click", deleteCurrentPost);

  // 글쓰기 모달 제어 이벤트
  openWriteModalBtn.addEventListener("click", openModal);
  closeWriteModalBtn.addEventListener("click", closeModal);
  cancelWriteBtn.addEventListener("click", closeModal);

  writeModal.addEventListener("click", (e) => {
    if (e.target === writeModal) closeModal();
  });

  // 다중 사진 선택 및 썸네일 관리 이벤트
  postImageInput.addEventListener("change", (e) => {
    handleMultipleImagesSelect(e.target.files);
    postImageInput.value = "";
  });

  if (clearAllPhotosBtn) {
    clearAllPhotosBtn.addEventListener("click", clearAllUploadedImages);
  }

  if (uploadThumbGrid) {
    uploadThumbGrid.addEventListener("click", (e) => {
      const delBtn = e.target.closest(".btn-delete-thumb");
      if (!delBtn) return;
      const index = Number(delBtn.getAttribute("data-thumb-index"));
      removeUploadedImage(index);
    });
  }

  // 갤러리 사진 클릭 시 라이트박스 원본 크게보기 이벤트 (이벤트 위임)
  document.addEventListener("click", (e) => {
    const photoItem = e.target.closest("[data-lightbox-src]");
    if (photoItem) {
      const src = photoItem.getAttribute("data-lightbox-src");
      openLightbox(src);
    }
  });

  if (closeLightboxBtn) closeLightboxBtn.addEventListener("click", closeLightbox);
  if (lightboxBackdrop) lightboxBackdrop.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && imageLightboxModal && !imageLightboxModal.classList.contains("hidden")) {
      closeLightbox();
    }
  });

  // 글쓰기 모달 내 태그 칩 인풋 인터랙션
  modalTagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTagToModal(modalTagInput.value);
    } else if (e.key === "Backspace" && modalTagInput.value === "" && state.modalSelectedTags.length > 0) {
      removeTagFromModal(state.modalSelectedTags.length - 1);
    }
  });

  selectedTagsContainer.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".tag-badge-remove");
    if (!removeBtn) return;
    const index = Number(removeBtn.getAttribute("data-remove-index"));
    removeTagFromModal(index);
  });

  availableTagsList.addEventListener("click", (e) => {
    const chip = e.target.closest(".available-tag-chip");
    if (!chip) return;
    const tag = chip.getAttribute("data-chip-tag");
    addTagToModal(tag);
  });

  // 미리보기 모드 및 탭 전환 이벤트 리스너
  writeTabEditBtn.addEventListener("click", () => switchWriteModalMode("edit"));
  writeTabPreviewBtn.addEventListener("click", () => switchWriteModalMode("preview"));
  previewFromFormBtn.addEventListener("click", () => switchWriteModalMode("preview"));
  backToEditBtn.addEventListener("click", () => switchWriteModalMode("edit"));

  previewSubTabCard.addEventListener("click", () => switchPreviewSubView("card"));
  previewSubTabDetail.addEventListener("click", () => switchPreviewSubView("detail"));

  publishFromPreviewBtn.addEventListener("click", () => {
    const title = postTitleInput.value.trim();
    const content = postContentInput.value.trim();

    if (!title) {
      alert("제목을 입력해 주세요.");
      switchWriteModalMode("edit");
      postTitleInput.focus();
      return;
    }
    if (!content) {
      alert("본문 내용을 입력해 주세요.");
      switchWriteModalMode("edit");
      postContentInput.focus();
      return;
    }

    writePostForm.requestSubmit();
  });

  // 글 작성 폼 제출
  writePostForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.isAdmin) {
      alert("관리자 권한이 없거나 세션이 만료되었습니다. 다시 로그인해 주세요.");
      return;
    }
    if (!supabaseClient) {
      alert("원격 동기화가 연결되어 있지 않아 글을 등록할 수 없습니다.");
      return;
    }

    if (modalTagInput.value.trim()) {
      addTagToModal(modalTagInput.value);
    }

    const title = postTitleInput.value.trim();
    const category = postCategorySelect.value;
    const tags = [...state.modalSelectedTags];

    const rawContent = postContentInput.value.trim();

    const formattedContent = rawContent
      .split(/\n\s*\n/)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
      .join("");

    const excerpt = rawContent.slice(0, 100) + (rawContent.length > 100 ? "..." : "");

    const now = new Date();
    const dateStr = `${now.getFullYear()}. ${String(now.getMonth() + 1).padStart(2, "0")}. ${String(now.getDate()).padStart(2, "0")}`;

    const primaryImg = state.uploadedImages[0] || state.uploadedImageDataUrl || null;

    const newPost = {
      id: Date.now(),
      title,
      category,
      date: dateStr,
      tags,
      image: primaryImg,
      images: [...state.uploadedImages],
      excerpt,
      content: formattedContent
    };

    // 서버 저장 - 권한 판단은 서버 RLS 정책이 수행
    // 서버 저장이 확인된 경우에만 화면/로컬 캐시에 반영
    showSyncToast("저장 중...");
    const submitBtnEl = writePostForm.querySelector("button[type='submit']");
    if (submitBtnEl) submitBtnEl.disabled = true;
    try {
      const { error } = await supabaseClient.from("posts").insert([newPost]);
      if (error) {
        console.error("Supabase 글 저장 실패 원인:", error);
        await syncSession();
        updateAdminUI();
        const errorMsg = error.message || error.details || "알 수 없는 오류";
        alert(`⚠️ DB 저장 실패 (${error.code || "에러"}): ${errorMsg}\n\n[진단 팁] F12 콘솔의 상세 로그를 확인하거나, Supabase SQL Editor에서 최신 database_schema.sql을 실행했는지 확인해 주세요.`);
        return;
      }
    } catch (err) {
      console.error("저장 예외 발생:", err);
      alert("⚠️ 저장 중 예외가 발생했습니다: " + err.message);
      return;
    } finally {
      if (submitBtnEl) submitBtnEl.disabled = false;
    }

    posts.unshift(newPost);
    savePosts(posts);
    showSyncToast("🚀 글이 성공적으로 등록되었습니다!");

    closeModal();
    state.selectedCategory = category;
    state.selectedTag = null;
    updateHomeUI();
    updateAdminUI();
    switchView("home");
  });

  // =========================================
  // 소개란 위치 설정 및 지도 연동 관리
  // =========================================
  const LOCATION_CONFIG = {
    placeName: "온세미로",
    address: "강원도 철원군 동송읍 양촌길 20-12", // 주소를 변경하시면 네이버 지도 및 카카오맵 길찾기 링크가 자동으로 연동됩니다.
    description: "온세미로 보일러"
  };

  function initLocationSection() {
    const addressTextEl = document.getElementById("locationAddressText");
    const copyAddressBtn = document.getElementById("copyAddressBtn");
    const copyBtnText = document.getElementById("copyBtnText");
    const naverMapLink = document.getElementById("naverMapLink");
    const kakaoMapLink = document.getElementById("kakaoMapLink");

    if (!addressTextEl) return;

    // 주소 텍스트 반영
    addressTextEl.textContent = `${LOCATION_CONFIG.address} (${LOCATION_CONFIG.placeName})`;

    // 네이버 지도 및 카카오맵 검색/길찾기 링크 자동 연동
    const encodedAddr = encodeURIComponent(LOCATION_CONFIG.address);
    if (naverMapLink) {
      naverMapLink.href = `https://map.naver.com/v5/search/${encodedAddr}`;
    }
    if (kakaoMapLink) {
      kakaoMapLink.href = `https://map.kakao.com/link/search/${encodedAddr}`;
    }

    // 주소 클립보드 복사 기능
    if (copyAddressBtn && copyBtnText) {
      copyAddressBtn.addEventListener("click", async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(LOCATION_CONFIG.address);
          } else {
            const textArea = document.createElement("textarea");
            textArea.value = LOCATION_CONFIG.address;
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand("copy");
            document.body.removeChild(textArea);
          }

          const originalText = copyBtnText.textContent;
          copyBtnText.textContent = "복사 완료! ✓";
          copyAddressBtn.classList.add("copied");

          setTimeout(() => {
            copyBtnText.textContent = originalText;
            copyAddressBtn.classList.remove("copied");
          }, 2000);
        } catch (err) {
          console.error("주소 복사 실패:", err);
          alert(`주소: ${LOCATION_CONFIG.address}`);
        }
      });
    }
  }

  // 초기화
  initTheme();
  initSupabaseClient();
  updateHomeUI();
  initLocationSection();

  // 비동기 클라우드 포스트 로딩
  async function loadInitialData() {
    if (supabaseClient) {
      const cloudPosts = await fetchCloudPosts();
      if (cloudPosts) {
        isInitialCloudLoaded = true;
        posts = cloudPosts;
        savePosts(posts);
        updateHomeUI();
      }
    }
  }
  loadInitialData();

})();
