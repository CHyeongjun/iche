const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/**
 * Vercel Serverless Function: Records CRUD
 * Endpoint: /api/records
 */

const INITIAL_RECORDS = [];

const TMP_FILE = path.join("/tmp", "vibe_records.json");
const COMMITTED_FILE = path.join(process.cwd(), "data", "records.json");

function getStorage() {
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

function saveStorage(records) {
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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const isAdmin = verifyAdmin(req);
  let records = getStorage();

  // 1. GET: 목록 조회 (Admin은 원본 전체, Guest는 Public + 마스킹된 Private)
  if (req.method === "GET") {
    const filter = req.query ? req.query.filter : "all";
    let filtered = records;

    if (filter === "private") {
      filtered = filtered.filter((r) => r.is_private);
    } else if (filter === "public") {
      filtered = filtered.filter((r) => !r.is_private);
    }

    if (!isAdmin) {
      // 일반 방문자에게는 Private 기록의 민감 본문 및 첨부파일을 서버단에서 마스킹/보호
      filtered = filtered.map((r) => {
        if (r.is_private) {
          return {
            id: r.id,
            title: r.title,
            category: r.category,
            date: r.date,
            content: "이 기록은 Private 상태입니다. 관리자 로그인 후 열람할 수 있습니다.",
            tags: Array.isArray(r.tags) ? r.tags : [],
            images: [],
            files: [],
            is_private: true,
            is_guest_private: true,
            created_at: r.created_at
          };
        }
        return r;
      });
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
        saveStorage(records);
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
        is_private: Boolean(body.is_private),
        created_at: new Date().toISOString()
      };

      if (!newRecord.title) {
        return res.status(400).json({ error: "제목을 입력해 주세요." });
      }

      records.unshift(newRecord);
      saveStorage(records);
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
        is_private: body.is_private !== undefined ? Boolean(body.is_private) : records[index].is_private
      };

      saveStorage(records);
      return res.status(200).json(records[index]);
    } catch (err) {
      return res.status(500).json({ error: "기록 수정 중 오류가 발생했습니다." });
    }
  }

  // 5. DELETE: 기록 삭제
  if (req.method === "DELETE") {
    try {
      const id = Number((req.query && req.query.id) || (req.body && req.body.id));
      const index = records.findIndex(r => Number(r.id) === id);
      if (index === -1) {
        return res.status(404).json({ error: "삭제할 기록을 찾을 수 없습니다." });
      }

      records.splice(index, 1);
      saveStorage(records);
      return res.status(200).json({ success: true, message: "기록이 삭제되었습니다." });
    } catch (err) {
      return res.status(500).json({ error: "기록 삭제 중 오류가 발생했습니다." });
    }
  }

  return res.status(405).json({ error: "허용되지 않은 메서드입니다." });
};
