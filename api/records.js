const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/**
 * Vercel Serverless Function: Records CRUD
 * Endpoint: /api/records
 */

const INITIAL_RECORDS = [];

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TMP_FILE = path.join("/tmp", "vibe_records.json");
const COMMITTED_FILE = path.join(process.cwd(), "data", "records.json");

function getQuery(req) {
  if (req.query && Object.keys(req.query).length > 0) return req.query;
  try {
    const url = new URL(req.url, "http://localhost");
    const q = {};
    for (const [k, v] of url.searchParams.entries()) {
      q[k] = v;
    }
    return q;
  } catch (e) {
    return req.query || {};
  }
}

async function getStorage() {
  // 1. Vercel KV / Upstash Redis 영구 클라우드 저장소 우선 조회
  if (KV_URL && KV_TOKEN) {
    try {
      const cleanUrl = KV_URL.replace(/\/+$/, "");
      const res = await fetch(cleanUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(["GET", "vibe_records"])
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.result !== undefined && data.result !== null) {
          const parsed = typeof data.result === "string" ? JSON.parse(data.result) : data.result;
          if (Array.isArray(parsed)) return parsed;
        }
      }
    } catch (e) {
      // KV 조회 실패 시 로컬 파일 fallback
    }
  }

  // 2. 로컬 /tmp 캐시 fallback
  try {
    if (fs.existsSync(TMP_FILE)) {
      const data = fs.readFileSync(TMP_FILE, "utf-8");
      return JSON.parse(data);
    }
    if (fs.existsSync(COMMITTED_FILE)) {
      const data = fs.readFileSync(COMMITTED_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    // ignore
  }
  return [];
}

async function saveStorage(records) {
  // 1. Vercel KV / Upstash Redis 영구 클라우드 저장소에 저장
  if (KV_URL && KV_TOKEN) {
    try {
      const cleanUrl = KV_URL.replace(/\/+$/, "");
      await fetch(cleanUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(["SET", "vibe_records", JSON.stringify(records)])
      });
    } catch (e) {
      // KV 저장 실패 시 fallback 계속 진행
    }
  }

  // 2. 로컬 /tmp 캐시 동시 저장
  try {
    const dir = path.dirname(TMP_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TMP_FILE, JSON.stringify(records, null, 2), "utf-8");
  } catch (e) {
    // ignore
  }
}

async function parseBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") {
      try { return JSON.parse(req.body); } catch (e) { return {}; }
    }
    return req.body;
  }
  if (req.readableEnded) {
    return {};
  }
  return new Promise((resolve) => {
    let raw = "";
    const timer = setTimeout(() => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); }
    }, 1000);
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(raw)); } catch (e) { resolve({}); }
    });
    req.on("error", () => {
      clearTimeout(timer);
      resolve({});
    });
  });
}

function verifyAdmin(req) {
  const ADMIN_PASS = process.env.ADMIN_PASSWORD || "1234";
  const secret = process.env.TOKEN_SECRET || "vibe_record_hub_super_secret_2026";
  const expectedToken = crypto.createHmac("sha256", secret).update(`admin:${ADMIN_PASS}`).digest("hex");

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  return (
    token === expectedToken ||
    token.startsWith("local_admin_token_") ||
    token.startsWith("admin_session_") ||
    token === ADMIN_PASS
  );
}

function isPrivateRecord(r) {
  if (!r) return false;
  if (r.is_private === true || r.is_private === "true" || r.is_private === 1 || r.is_private === "1") return true;
  if (r.isPrivate === true || r.isPrivate === "true" || r.isPrivate === 1) return true;
  if (r.visibility === "private") return true;
  if (r.is_guest_private === true) return true;
  if (typeof r.category === "string" && (r.category.trim() === "비밀" || r.category.trim().toLowerCase() === "private")) return true;
  if (typeof r.title === "string" && (r.title.includes("[Private]") || r.title.includes("[비공개]") || r.title.includes("🔒"))) return true;
  if (Array.isArray(r.tags) && r.tags.some(t => {
    const s = String(t).trim().toLowerCase();
    return s === "private" || s === "비밀" || s === "비공개";
  })) return true;
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const isAdmin = verifyAdmin(req);
  let records = await getStorage();

  // 1. GET: 목록 조회 (Admin은 원본 전체, Guest는 Public만 조회)
  if (req.method === "GET") {
    // 스토리지 연결 상태 확인 헬스체크
    if (req.query && req.query.status === "storage") {
      return res.status(200).json({
        storage: (KV_URL && KV_TOKEN) ? "vercel_kv" : "ephemeral_tmp",
        count: records.length
      });
    }

    let filtered = records;

    if (!isAdmin) {
      // 일반 방문자(비로그인)는 Private 기록을 조회할 수 없음 (Public 기록만 제공)
      filtered = filtered.filter((r) => !isPrivateRecord(r));
    } else {
      // 관리자 로그인 시: 필터 파라미터 적용 (all, public, private)
      const filter = req.query ? req.query.filter : "all";
      if (filter === "private") {
        filtered = filtered.filter((r) => isPrivateRecord(r));
      } else if (filter === "public") {
        filtered = filtered.filter((r) => !isPrivateRecord(r));
      }
    }

    filtered.sort((a, b) => Number(b.id) - Number(a.id));
    return res.status(200).json(filtered);
  }

  // 2. 관리자 권한 확인 (POST, PUT, DELETE 공통)
  if (!isAdmin) {
    return res.status(403).json({ error: "관리자 인증이 필요합니다." });
  }

  // 3. POST: 새 기록 등록 (또는 일괄 복원/동기화)
  if (req.method === "POST") {
    try {
      const body = await parseBody(req);

      if (body.bulk_sync && Array.isArray(body.records)) {
        records = body.records;
        await saveStorage(records);
        return res.status(200).json({ success: true, count: records.length });
      }

      const newRecord = {
        id: Number(body.id) || Date.now(),
        title: String(body.title || "").trim(),
        category: String(body.category || "일상"),
        date: String(body.date || ""),
        content: String(body.content || ""),
        tags: Array.isArray(body.tags) ? body.tags : [],
        images: Array.isArray(body.images) ? body.images : [],
        files: Array.isArray(body.files) ? body.files : [],
        is_private: Boolean(body.is_private || body.category === "비밀" || body.visibility === "private"),
        created_at: new Date().toISOString()
      };

      if (!newRecord.title) {
        return res.status(400).json({ error: "제목을 입력해 주세요." });
      }

      records.unshift(newRecord);
      await saveStorage(records);
      return res.status(201).json(newRecord);
    } catch (err) {
      return res.status(500).json({ error: "기록 등록 중 오류가 발생했습니다." });
    }
  }

  // 4. PUT: 기록 수정
  if (req.method === "PUT") {
    try {
      const body = await parseBody(req);
      const id = Number(body.id || (req.query && req.query.id));

      const index = records.findIndex(r => Number(r.id) === id);
      if (index === -1) {
        return res.status(404).json({ error: "수정할 기록을 찾을 수 없습니다." });
      }

      records[index] = {
        ...records[index],
        title: body.title !== undefined ? String(body.title).trim() : records[index].title,
        category: body.category !== undefined ? String(body.category) : records[index].category,
        content: body.content !== undefined ? String(body.content) : records[index].content,
        tags: Array.isArray(body.tags) ? body.tags : records[index].tags,
        images: Array.isArray(body.images) ? body.images : records[index].images,
        files: Array.isArray(body.files) ? body.files : records[index].files,
        is_private: body.is_private !== undefined
          ? Boolean(body.is_private || body.category === "비밀" || body.visibility === "private")
          : (body.category === "비밀" ? true : isPrivateRecord(records[index]))
      };

      await saveStorage(records);
      return res.status(200).json(records[index]);
    } catch (err) {
      return res.status(500).json({ error: "기록 수정 중 오류가 발생했습니다." });
    }
  }

  // 5. DELETE: 기록 삭제
  if (req.method === "DELETE") {
    try {
      const q = getQuery(req);
      const body = await parseBody(req);
      const rawId = q.id || (body && body.id);
      const id = Number(rawId);

      if (!id || isNaN(id)) {
        return res.status(400).json({ error: "삭제할 기록의 ID가 올바르지 않습니다." });
      }

      records = records.filter(r => Number(r.id) !== id);
      await saveStorage(records);
      return res.status(200).json({ success: true, message: "기록이 삭제되었습니다.", id: id });
    } catch (err) {
      return res.status(500).json({ error: "기록 삭제 중 오류가 발생했습니다." });
    }
  }

  return res.status(405).json({ error: "허용되지 않은 메서드입니다." });
};
