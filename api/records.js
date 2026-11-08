const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/**
 * Vercel Serverless Function: Records CRUD
 * Endpoint: /api/records
 */

// Starter records if storage is clean
const INITIAL_RECORDS = [
  {
    id: 1730000000001,
    title: "사이버네틱 퍼스널 레코드 허브 구축 완료",
    category: "개발",
    date: "2026.11.07",
    content: "Vercel 서버리스 아키텍처로 완전 마이그레이션된 개인 기록 보관소입니다.\n\n```javascript\n// Vercel Serverless Function & REST API 완벽 연동\nconst res = await fetch('/api/records');\nconst records = await res.json();\nconsole.log('총 기록 개수:', records.length);\n```\n\n모든 공개 기록은 누구나 열람할 수 있으며, 관리자 인증 시 Private 기록 열람 및 작성/수정/삭제 권한이 부여됩니다.",
    tags: ["Vercel", "보안", "사이버네틱"],
    images: [],
    files: [],
    is_private: false,
    created_at: new Date().toISOString()
  },
  {
    id: 1730000000002,
    title: "비공개 보안 프로젝트 및 개인 아키텍처 노트",
    category: "비밀",
    date: "2026.11.08",
    content: "이 글은 비공개(Private)로 등록된 기록입니다.\n\n관리자(소유자)로 로그인했을 때만 선명하게 전체 내용이 표시되며, 일반 방문객에게는 목록에서 흐릿하게 표시되어 비공개 상태임을 알립니다.",
    tags: ["비밀", "보안", "Private"],
    images: [],
    files: [],
    is_private: true,
    created_at: new Date().toISOString()
  }
];

const TMP_FILE = path.join("/tmp", "vibe_records.json");

function getStorage() {
  try {
    if (fs.existsSync(TMP_FILE)) {
      const data = fs.readFileSync(TMP_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    // ignore
  }
  return [...INITIAL_RECORDS];
}

function saveStorage(records) {
  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify(records, null, 2), "utf-8");
  } catch (e) {
    // ignore
  }
}

async function parseBody(req) {
  if (req.body) {
    if (typeof req.body === "string") {
      try { return JSON.parse(req.body); } catch (e) { return {}; }
    }
    return req.body;
  }
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(raw)); } catch (e) { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

function verifyAdmin(req) {
  const ADMIN_PASS = process.env.ADMIN_PASSWORD || "1234";
  const secret = process.env.TOKEN_SECRET || "vibe_record_hub_super_secret_2026";
  const expectedToken = crypto.createHmac("sha256", secret).update(`admin:${ADMIN_PASS}`).digest("hex");

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return Boolean(token && token === expectedToken);
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
            content: "🔒 이 기록은 비공개(Private) 상태입니다. 관리자 로그인 후 열람할 수 있습니다.",
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

  // 3. POST: 새 기록 등록
  if (req.method === "POST") {
    try {
      const body = await parseBody(req);

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
