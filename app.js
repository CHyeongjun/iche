// =========================================
// 데이터 관리 (localStorage 동기화)
// =========================================
const STORAGE_KEY_POSTS = "vibe_blog_posts";
const STORAGE_KEY_TAGS = "vibe_blog_tags";
const STORAGE_KEY_AUTH = "vibe_blog_is_admin";
const STORAGE_KEY_VIEW_MODE = "vibe_blog_view_mode";

// 관리자 비밀번호 해시 (Salted SHA-256 단방향 암호화 - 원본 암호 노출 차단)
const ADMIN_PASSWORD_HASH = "666c8f6c063a2d8dcb97ddcad4e641b5f038e391e3120330a8f97c64464d20a8";
const PASSWORD_SALT = "vibe_blog_admin_salt_#2026_";
const STORAGE_KEY_CUSTOM_HASH = "vibe_blog_admin_hash";

// 비밀번호 SHA-256 해시 함수
async function hashPassword(plainText) {
  const encoder = new TextEncoder();
  const data = encoder.encode(PASSWORD_SALT + plainText);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function loadPosts() {
  const saved = localStorage.getItem(STORAGE_KEY_POSTS);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error("포스트 데이터 파싱 실패", e);
    }
  }
  return [...INITIAL_POSTS];
}

function savePosts(newPosts) {
  localStorage.setItem(STORAGE_KEY_POSTS, JSON.stringify(newPosts));
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
const STORAGE_KEY_SUPABASE_CONFIG = "vibe_blog_supabase_config";

// 프로젝트 코드에 직접 URL과 Anon Key를 입력해두시면 모든 기기에서 자동 연결됩니다:
const DEFAULT_SUPABASE_CONFIG = {
  url: "https://bqfbfrxrubmqkdjouyjk.supabase.co", // 사용자 실제 프로젝트 URL
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxZmJmcnhydWJtcWtkam91eWprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2MTY0NjgsImV4cCI6MjEwOTE5MjQ2OH0.ObqTtAZJG_MddUCHmOe0YayzXnLQyRJX5lGAg462Ghg" // Supabase의 Project Settings ➜ API ➜ 'anon public' 키를 여기에 입력하세요
};

function getSupabaseConfig() {
  if (DEFAULT_SUPABASE_CONFIG.url && DEFAULT_SUPABASE_CONFIG.anonKey) {
    return DEFAULT_SUPABASE_CONFIG;
  }
  const saved = localStorage.getItem(STORAGE_KEY_SUPABASE_CONFIG);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.url && parsed.anonKey) return parsed;
    } catch (e) { }
  }
  return null;
}

function saveSupabaseConfig(config) {
  localStorage.setItem(STORAGE_KEY_SUPABASE_CONFIG, JSON.stringify(config));
  initSupabaseClient();
}

function removeSupabaseConfig() {
  localStorage.removeItem(STORAGE_KEY_SUPABASE_CONFIG);
  supabaseClient = null;
  updateCloudSyncUI();
}

let supabaseClient = null;
let isInitialCloudLoaded = false;
let _waitingSdk = false;

function initSupabaseClient() {
  const config = getSupabaseConfig();
  if (config && config.url && config.anonKey) {
    if (window.supabase) {
      try {
        supabaseClient = window.supabase.createClient(config.url, config.anonKey);
      } catch (e) {
        console.warn("Supabase 클라이언트 생성 실패:", e);
        supabaseClient = null;
      }
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
        try {
          supabaseClient = window.supabase.createClient(config.url, config.anonKey);
        } catch (e) {
          console.warn("Supabase 클라이언트 생성 실패:", e);
        }
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
            supabaseClient = window.supabase.createClient(config.url, config.anonKey);
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
      badge.textContent = "☁️ 클라우드 DB 연결됨";
      badge.classList.add("connected");
      badge.title = "어느 기기에서든 실시간으로 글이 저장·공개됩니다 (클릭하여 설정)";
    } else {
      badge.textContent = "☁️ 클라우드 DB 미연동";
      badge.classList.remove("connected");
      badge.title = "클라우드 DB를 연결하면 다른 컴퓨터에서도 실시간 글 작성이 가능합니다 (클릭하여 설정)";
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
      console.warn("클라우드 DB 글 조회 오류:", error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn("클라우드 DB 통신 오류:", err);
    return null;
  }
}

async function seedInitialPostsToCloud() {
  if (!supabaseClient || INITIAL_POSTS.length === 0) return;
  try {
    const { error } = await supabaseClient.from("posts").insert(INITIAL_POSTS);
    if (!error) {
      console.log("초기 기본 글이 클라우드 DB에 성공적으로 등록되었습니다.");
    }
  } catch (e) {
    console.warn("초기 글 등록 생략:", e);
  }
}

function loadCustomTags() {
  const saved = localStorage.getItem(STORAGE_KEY_TAGS);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error("태그 데이터 파싱 실패", e);
    }
  }
  const initialTagSet = new Set();
  INITIAL_POSTS.forEach((p) => {
    (p.tags || []).forEach((t) => initialTagSet.add(t));
  });
  return Array.from(initialTagSet);
}

function saveCustomTags(tagList) {
  localStorage.setItem(STORAGE_KEY_TAGS, JSON.stringify(tagList));
}

let posts = loadPosts();
let customTags = loadCustomTags();

// =========================================
// 상태 관리
// =========================================
const state = {
  isAdmin: localStorage.getItem(STORAGE_KEY_AUTH) === "true",
  selectedCategory: "전체",
  selectedTag: null,
  currentView: "home", // 'home' | 'post' | 'about'
  currentPostId: null,
  uploadedImages: [], // 새로 업로드할 사진 목록 (base64 배열)
  uploadedImageDataUrl: null, // 첫 번째 대표 사진 (호환성)
  modalSelectedTags: [], // 글쓰기 모달에서 선택된 태그 목록
  writeModalMode: "edit", // 'edit' | 'preview'
  previewSubView: "card", // 'card' | 'detail'
  viewMode: localStorage.getItem(STORAGE_KEY_VIEW_MODE) || "list" // 'list' | 'album'
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

async function handleLogin(password) {
  try {
    const hashedInput = await hashPassword(password);
    const validHash = localStorage.getItem(STORAGE_KEY_CUSTOM_HASH) || ADMIN_PASSWORD_HASH;
    if (hashedInput === validHash) {
      state.isAdmin = true;
      localStorage.setItem(STORAGE_KEY_AUTH, "true");
      closeAuthModal();
      updateAdminUI();
      renderTags();
    } else {
      loginErrorMsg.classList.remove("hidden");
      adminPasswordInput.focus();
    }
  } catch (err) {
    console.error("비밀번호 검증 오류", err);
    loginErrorMsg.classList.remove("hidden");
  }
}

function handleLogout() {
  if (confirm("관리자 모드에서 로그아웃하시겠습니까?")) {
    state.isAdmin = false;
    localStorage.removeItem(STORAGE_KEY_AUTH);
    updateAdminUI();
    renderTags();
  }
}

function openAuthModal() {
  loginErrorMsg.classList.add("hidden");
  adminPasswordInput.value = "";
  loginModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
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
  const savedTheme = localStorage.getItem("vibe_blog_theme");
  if (savedTheme) {
    htmlEl.setAttribute("data-theme", savedTheme);
  } else {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    htmlEl.setAttribute("data-theme", prefersDark ? "dark" : "light");
  }
}

function toggleTheme() {
  const current = htmlEl.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  htmlEl.setAttribute("data-theme", next);
  localStorage.setItem("vibe_blog_theme", next);
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
      return `
        <button
          type="button"
          class="category-tab ${isActive}"
          data-category="${category}"
          role="tab"
          aria-selected="${state.selectedCategory === category}"
        >
          ${category}<span class="category-count">${count}</span>
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
        return `
          <button
            type="button"
            class="tag-pill ${isActive}"
            data-tag="${tag}"
          >
            #${tag}
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
  const cleanTag = tagName.trim().replace(/^#/, "");
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

      let thumbHtml = "";
      if (hasThumb) {
        thumbHtml = `
          <div class="post-item-thumb">
            <img src="${primaryImg}" alt="${post.title}" loading="lazy" />
            ${multiBadge}
          </div>
        `;
      } else if (state.viewMode === "album") {
        // 앨범형 모드에서는 사진이 없더라도 균형 잡힌 테마 플레이스홀더를 제공
        thumbHtml = `
          <div class="post-item-thumb thumb-placeholder">
            <span class="thumb-placeholder-icon">${catIcon}</span>
            <span class="thumb-placeholder-text">${post.category} 이야기</span>
          </div>
        `;
      }

      return `
      <article class="post-item" data-post-id="${post.id}">
        <div class="post-item-main">
          <div class="post-item-text">
            <div class="post-item-header">
              <span class="post-category-badge">${post.category}</span>
              <span class="meta-divider">·</span>
              <time class="post-date">${post.date}</time>
            </div>
            <h2 class="post-item-title">${post.title}</h2>
            <p class="post-item-excerpt">${post.excerpt || ""}</p>
            <div class="post-item-tags">
              ${(post.tags || [])
          .map(
            (tag) =>
              `<span class="post-item-tag" data-inline-tag="${tag}">#${tag}</span>`
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

  // 최대 4칸까지 그리드로 시각화 (5장 이상은 4번째에 +N 오버레이)
  const displayImages = count <= 4 ? images : images.slice(0, 4);

  const gridItemsHtml = displayImages
    .map((imgSrc, idx) => {
      const isFourthOfMany = count >= 5 && idx === 3;
      const overlayHtml = isFourthOfMany
        ? `
          <div class="gallery-more-overlay">
            <span class="more-count">+${count - 3}</span>
            <span class="more-label">전체 사진 보기</span>
          </div>
        `
        : "";

      return `
        <div class="gallery-photo-item" data-lightbox-src="${imgSrc}" title="사진 클릭 시 원본 크게 보기">
          <img src="${imgSrc}" alt="${altTitle} - 사진 ${idx + 1}" loading="lazy" />
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
          (imgSrc, i) => `
          <button type="button" class="sub-thumb-btn" data-lightbox-src="${imgSrc}" title="사진 ${i + 1} 원본 크게보기">
            <img src="${imgSrc}" alt="${altTitle} 썸네일 ${i + 1}" loading="lazy" />
          </button>
        `
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
  if (!imgSrc || !imageLightboxModal || !lightboxImg) return;
  lightboxImg.src = imgSrc;
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

  postDetailContent.innerHTML = `
    <header class="article-header">
      <span class="post-category-badge">${post.category}</span>
      <h1 class="article-title">${post.title}</h1>
      <div class="article-meta">
        <time>${post.date}</time>
      </div>
      <div class="post-item-tags">
        ${(post.tags || [])
      .map(
        (tag) =>
          `<button type="button" class="tag-pill" data-detail-tag="${tag}">#${tag}</button>`
      )
      .join("")}
      </div>
    </header>
    ${galleryHtml}
    <div class="article-body">
      ${post.content}
    </div>
  `;

  deletePostBtn.classList.toggle("hidden", !state.isAdmin);

  switchView("post");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteCurrentPost() {
  if (!state.isAdmin || !state.currentPostId) return;
  if (!confirm("정말로 이 글을 삭제하시겠습니까?")) return;

  const deletedId = Number(state.currentPostId);

  // 1) Supabase 클라우드 실시간 삭제 처리
  if (supabaseClient) {
    showSyncToast("☁️ 클라우드 DB에서 글 삭제 중...");
    try {
      const { error, count } = await supabaseClient
        .from("posts")
        .delete({ count: "exact" })
        .eq("id", deletedId);

      if (error) {
        console.error("클라우드 DB 삭제 실패:", error);
        alert(`⚠️ 클라우드 DB 삭제 실패: ${error.message}\n(Supabase SQL Editor에서 삭제 권한 정책을 확인해 주세요)`);
        return;
      }
      if (count === 0) {
        console.warn("클라우드 DB에서 삭제된 행 수가 0입니다. (이미 삭제되었거나 RLS 정책 확인 필요)");
      }
    } catch (err) {
      console.error("클라우드 삭제 통신 오류:", err);
      alert(`⚠️ 삭제 실패: ${err.message}`);
      return;
    }
  }

  // 2) 로컬 상태 및 localStorage에서도 삭제
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
      (tag, index) => `
      <span class="tag-badge">
        #${tag}
        <span class="tag-badge-remove" data-remove-index="${index}" title="삭제">✕</span>
      </span>
    `
    )
    .join("");

  const allTags = getAllTags();
  availableTagsList.innerHTML = allTags
    .map((tag) => {
      const isAdded = state.modalSelectedTags.includes(tag);
      return `
        <button
          type="button"
          class="available-tag-chip ${isAdded ? "added" : ""}"
          data-chip-tag="${tag}"
        >
          + ${tag}
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
      (tag) => `
      <div class="manage-tag-chip">
        <span>#${tag}</span>
        <button type="button" class="manage-tag-delete-btn" data-delete-tag="${tag}" title="'#${tag}' 태그 삭제">✕</button>
      </div>
    `
    )
    .join("");
}

function openManageTagsModal() {
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

  const displayTitle = rawTitle || `<span class="preview-placeholder-text">(작성 중인 제목이 표시됩니다)</span>`;
  const plainTitleForAlt = rawTitle || "미리보기 이미지";

  const excerpt = rawContent
    ? (rawContent.slice(0, 100) + (rawContent.length > 100 ? "..." : ""))
    : `<span class="preview-placeholder-text">(본문 내용이 작성되면 앞부분이 목록에 자동으로 요약 표시됩니다)</span>`;

  const formattedContent = rawContent
    ? rawContent
      .split(/\n\s*\n/)
      .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
      .join("")
    : `<p class="preview-placeholder-text">(본문 내용이 작성되면 실제 글 읽기 화면 스타일로 문단과 줄바꿈이 깔끔하게 표시됩니다)</p>`;

  // 1) 목록 카드 뷰 렌더링
  const primaryImg = state.uploadedImages[0] || state.uploadedImageDataUrl || null;
  const multiBadge = state.uploadedImages.length > 1
    ? `<span class="multi-photo-badge">📷 ${state.uploadedImages.length}</span>`
    : "";

  const cardThumbHtml = primaryImg
    ? `<div class="post-item-thumb"><img src="${primaryImg}" alt="${plainTitleForAlt}" />${multiBadge}</div>`
    : "";

  const tagsHtml = tags.length > 0
    ? tags.map((t) => `<span class="post-item-tag">#${t}</span>`).join("")
    : `<span class="post-item-tag preview-placeholder-text">#태그미지정</span>`;

  previewCardContainer.innerHTML = `
    <div class="preview-card-frame">
      <article class="post-item">
        <div class="post-item-main">
          <div class="post-item-text">
            <div class="post-item-header">
              <span class="post-category-badge">${category}</span>
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
    ? tags.map((t) => `<span class="tag-pill">#${t}</span>`).join("")
    : `<span class="tag-pill preview-placeholder-text">#태그미지정</span>`;

  const galleryHtml = renderMultiPhotoGallery(state.uploadedImages, plainTitleForAlt, true);

  previewDetailContainer.innerHTML = `
    <div class="preview-detail-frame">
      <header class="article-header">
        <span class="post-category-badge">${category}</span>
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
        ${formattedContent}
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

function handleMultipleImagesSelect(files) {
  if (!files || files.length === 0) return;

  const validFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
  if (validFiles.length === 0) {
    alert("이미지 파일만 업로드할 수 있습니다.");
    return;
  }

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
      const primaryBadge = idx === 0 ? `<span class="primary-badge">대표</span>` : "";
      return `
        <div class="upload-thumb-item">
          <img src="${imgSrc}" alt="업로드 사진 ${idx + 1}" />
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

// Supabase 클라우드 설정 모달 관련 DOM & 이벤트 리스너
const cloudConfigModal = document.getElementById("cloudConfigModal");
const openCloudModalBtn = document.getElementById("openCloudModalBtn");
const cloudSyncStatusBadge = document.getElementById("cloudSyncStatusBadge");
const closeCloudModalBtn = document.getElementById("closeCloudModalBtn");
const closeCloudModalBackdrop = document.getElementById("closeCloudModalBackdrop");
const cloudConfigForm = document.getElementById("cloudConfigForm");
const supabaseUrlInput = document.getElementById("supabaseUrlInput");
const supabaseKeyInput = document.getElementById("supabaseKeyInput");
const testCloudConnectionBtn = document.getElementById("testCloudConnectionBtn");
const disconnectCloudBtn = document.getElementById("disconnectCloudBtn");
const cloudConnectionStatusMsg = document.getElementById("cloudConnectionStatusMsg");
const copySqlBtn = document.getElementById("copySqlBtn");
const sqlCodeBox = document.getElementById("sqlCodeBox");

function openCloudConfigModal() {
  if (!cloudConfigModal) return;
  const config = getSupabaseConfig() || {};
  supabaseUrlInput.value = config.url || "";
  supabaseKeyInput.value = config.anonKey || "";

  if (cloudConnectionStatusMsg) {
    cloudConnectionStatusMsg.className = "connection-status-msg hidden";
    cloudConnectionStatusMsg.textContent = "";
  }

  cloudConfigModal.classList.remove("hidden");
  setTimeout(() => supabaseUrlInput.focus(), 50);
}

function closeCloudConfigModal() {
  if (!cloudConfigModal) return;
  cloudConfigModal.classList.add("hidden");
}

if (openCloudModalBtn) openCloudModalBtn.addEventListener("click", openCloudConfigModal);
if (cloudSyncStatusBadge) cloudSyncStatusBadge.addEventListener("click", openCloudConfigModal);
if (closeCloudModalBtn) closeCloudModalBtn.addEventListener("click", closeCloudConfigModal);
if (closeCloudModalBackdrop) closeCloudModalBackdrop.addEventListener("click", closeCloudConfigModal);

if (copySqlBtn && sqlCodeBox) {
  copySqlBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(sqlCodeBox.textContent.trim());
      copySqlBtn.textContent = "복사 완료! ✓";
      setTimeout(() => (copySqlBtn.textContent = "SQL 복사하기"), 2000);
    } catch (e) {
      alert("직접 드래그하여 복사해 주세요.");
    }
  });
}

function cleanSupabaseUrl(rawUrl) {
  let u = (rawUrl || "").trim();
  if (u.includes("supabase.com/dashboard")) {
    throw new Error("대시보드 웹페이지 주소가 아니라, Supabase의 'Project Settings ➜ API' 에 있는 'Project URL' (예: https://xxxx.supabase.co)을 입력하셔야 합니다.");
  }
  if (!u.startsWith("http://") && !u.startsWith("https://")) {
    u = "https://" + u;
  }
  u = u.replace(/\/+$/, "");
  u = u.replace(/\/rest\/v1\/?$/, "");
  return u;
}

function formatSupabaseError(err) {
  const msg = err.message || String(err);
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || err.name === "TypeError") {
    return "네트워크 연결 실패: Project URL을 잘못 입력하셨거나 접속할 수 없습니다.\nURL 형태가 'https://xxxx.supabase.co' 인지 확인해 주세요. (대시보드 주소 X)";
  }
  if ((msg.includes("relation") && msg.includes("does not exist")) || err.code === "42P01") {
    return "연결은 되었으나 'posts' 테이블이 생성되지 않았습니다!\nSupabase 대시보드 ➜ SQL Editor에서 아래 [테이블 생성 SQL]을 복사해 실행(Run)해 주세요.";
  }
  if (msg.includes("Invalid API key") || msg.includes("JWT") || msg.includes("apikey") || msg.includes("invalid claim")) {
    return "API Key 오류: Supabase의 Project Settings ➜ API ➜ 'anon public' 키를 정확히 복사했는지 확인해 주세요.";
  }
  return msg;
}

if (cloudConfigForm) {
  cloudConfigForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const rawUrl = supabaseUrlInput.value.trim();
    const anonKey = supabaseKeyInput.value.trim();

    if (!rawUrl || !anonKey) {
      alert("Project URL과 Anon Key를 모두 입력해 주세요.");
      return;
    }

    try {
      const url = cleanSupabaseUrl(rawUrl);

      if (cloudConnectionStatusMsg) {
        cloudConnectionStatusMsg.className = "connection-status-msg loading";
        cloudConnectionStatusMsg.textContent = "⏳ Supabase 클라우드 연결 테스트 중...";
        cloudConnectionStatusMsg.classList.remove("hidden");
      }

      if (!window.supabase) {
        throw new Error("Supabase SDK를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
      }

      const testClient = window.supabase.createClient(url, anonKey);
      const { data, error } = await testClient.from("posts").select("id").limit(1);

      if (error) {
        throw error;
      }

      saveSupabaseConfig({ url, anonKey });

      if (cloudConnectionStatusMsg) {
        cloudConnectionStatusMsg.className = "connection-status-msg success";
        cloudConnectionStatusMsg.textContent = "✅ 클라우드 DB 연결 성공! 설정이 저장되었습니다.";
      }

      showSyncToast("☁️ Supabase 클라우드 DB 연동 완료!");

      // 최신 글 다시 불러오기
      const cloudPosts = await fetchCloudPosts();
      if (cloudPosts && cloudPosts.length > 0) {
        posts = cloudPosts;
        savePosts(posts);
        updateHomeUI();
      }

      setTimeout(() => closeCloudConfigModal(), 900);
    } catch (err) {
      if (cloudConnectionStatusMsg) {
        cloudConnectionStatusMsg.className = "connection-status-msg error";
        cloudConnectionStatusMsg.textContent = `❌ ${formatSupabaseError(err)}`;
      }
    }
  });
}

if (testCloudConnectionBtn) {
  testCloudConnectionBtn.addEventListener("click", async () => {
    const rawUrl = supabaseUrlInput.value.trim();
    const anonKey = supabaseKeyInput.value.trim();

    if (!rawUrl || !anonKey) {
      alert("URL과 Key를 입력한 후 테스트해 주세요.");
      return;
    }

    try {
      const url = cleanSupabaseUrl(rawUrl);

      if (cloudConnectionStatusMsg) {
        cloudConnectionStatusMsg.className = "connection-status-msg loading";
        cloudConnectionStatusMsg.textContent = "⏳ 연결 테스트 중...";
        cloudConnectionStatusMsg.classList.remove("hidden");
      }

      if (!window.supabase) throw new Error("Supabase SDK를 로딩 중입니다.");
      const testClient = window.supabase.createClient(url, anonKey);
      const { data, error } = await testClient.from("posts").select("id").limit(1);

      if (error) throw error;

      if (cloudConnectionStatusMsg) {
        cloudConnectionStatusMsg.className = "connection-status-msg success";
        cloudConnectionStatusMsg.textContent = "✅ Supabase 'posts' 테이블과 성공적으로 연결되었습니다!";
      }
    } catch (err) {
      if (cloudConnectionStatusMsg) {
        cloudConnectionStatusMsg.className = "connection-status-msg error";
        cloudConnectionStatusMsg.textContent = `❌ ${formatSupabaseError(err)}`;
      }
    }
  });
}

if (disconnectCloudBtn) {
  disconnectCloudBtn.addEventListener("click", () => {
    if (confirm("클라우드 DB 연동을 해제하시겠습니까?")) {
      removeSupabaseConfig();
      supabaseUrlInput.value = "";
      supabaseKeyInput.value = "";
      if (cloudConnectionStatusMsg) {
        cloudConnectionStatusMsg.className = "connection-status-msg";
        cloudConnectionStatusMsg.textContent = "연동이 해제되었습니다.";
      }
      showSyncToast("☁️ 클라우드 DB 연동이 해제되었습니다.");
      setTimeout(() => closeCloudConfigModal(), 700);
    }
  });
}

closeLoginModalBtn.addEventListener("click", closeAuthModal);
cancelLoginBtn.addEventListener("click", closeAuthModal);

loginModal.addEventListener("click", (e) => {
  if (e.target === loginModal) closeAuthModal();
});

adminLoginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  await handleLogin(adminPasswordInput.value.trim());
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
  localStorage.setItem(STORAGE_KEY_VIEW_MODE, mode);
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
writePostForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!state.isAdmin) {
    alert("관리자 권한이 없습니다.");
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
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
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

  posts.unshift(newPost);
  savePosts(posts);

  // Supabase 클라우드 실시간 저장
  if (supabaseClient) {
    showSyncToast("☁️ 클라우드 DB에 실시간 저장 중...");
    supabaseClient
      .from("posts")
      .insert([newPost])
      .then(({ error }) => {
        if (error) {
          console.error("클라우드 저장 실패:", error);
          alert(`⚠️ 클라우드 저장 실패: ${error.message}\n(글은 로컬에 저장되었습니다)`);
        } else {
          showSyncToast("🚀 글이 등록되었습니다! (모든 기기 실시간 반영)");
        }
      });
  } else {
    showSyncToast("글이 등록되었습니다. (로컬 모드)");
  }

  closeModal();
  state.selectedCategory = category;
  state.selectedTag = null;
  updateHomeUI();
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
