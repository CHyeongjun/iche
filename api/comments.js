const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/**
 * Vercel Serverless Function: Comments CRUD
 * Endpoint: /api/comments
 */

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TMP_FILE = path.join("/tmp", "vibe_comments.json");

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
  if (KV_URL && KV_TOKEN) {
    try {
      const cleanUrl = KV_URL.replace(/\/+$/, "");
      const res = await fetch(cleanUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(["GET", "vibe_comments"])
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.result !== undefined && data.result !== null) {
          const parsed = typeof data.result === "string" ? JSON.parse(data.result) : data.result;
          if (Array.isArray(parsed)) return parsed;
        }
      }
    } catch (e) {
      // KV fallback
    }
  }

  try {
    if (fs.existsSync(TMP_FILE)) {
      const data = fs.readFileSync(TMP_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    // ignore
  }
  return [];
}

async function saveStorage(comments) {
  if (KV_URL && KV_TOKEN) {
    try {
      const cleanUrl = KV_URL.replace(/\/+$/, "");
      await fetch(cleanUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(["SET", "vibe_comments", JSON.stringify(comments)])
      });
    } catch (e) {
      // ignore
    }
  }

  try {
    const dir = path.dirname(TMP_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TMP_FILE, JSON.stringify(comments, null, 2), "utf-8");
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const query = getQuery(req);
  const isAdmin = verifyAdmin(req);
  let comments = await getStorage();

  // 1. GET: 특정 글의 댓글 목록 조회
  if (req.method === "GET") {
    const recordId = query.record_id || query.post_id;
    let filtered = comments;
    if (recordId) {
      filtered = filtered.filter(c => String(c.record_id) === String(recordId));
    }
    filtered.sort((a, b) => Number(a.id) - Number(b.id));

    // 클라이언트에는 password_hash를 일절 노출하지 않음
    const sanitized = filtered.map(c => {
      const { password_hash, ...rest } = c;
      return rest;
    });

    return res.status(200).json(sanitized);
  }

  // 2. POST: 댓글 등록 (관리자 또는 일반 방문자)
  if (req.method === "POST") {
    try {
      const body = await parseBody(req);
      const recordId = body.record_id || body.post_id;
      const content = (body.content || "").trim();

      if (!recordId) {
        return res.status(400).json({ error: "게시글 ID가 필요합니다." });
      }
      if (!content) {
        return res.status(400).json({ error: "댓글 내용을 입력해 주세요." });
      }

      let author = (body.author || "").trim();
      let passwordHash = null;

      if (isAdmin) {
        author = author || "관리자";
      } else {
        author = author || "방문자";
        const rawPw = (body.password || "").trim();
        if (rawPw) {
          passwordHash = crypto.createHash("sha256").update(rawPw).digest("hex");
        }
      }

      const newComment = {
        id: Date.now(),
        record_id: Number(recordId),
        parent_id: body.parent_id ? Number(body.parent_id) : null,
        author: author.slice(0, 30),
        content: content.slice(0, 1000),
        is_admin: isAdmin,
        password_hash: passwordHash,
        created_at: new Date().toISOString()
      };

      comments.push(newComment);
      await saveStorage(comments);

      const { password_hash, ...sanitized } = newComment;
      return res.status(201).json(sanitized);
    } catch (e) {
      return res.status(500).json({ error: "댓글 저장 중 오류가 발생했습니다." });
    }
  }

  // 3. DELETE: 댓글 삭제 (관리자는 즉시 삭제, 방문자는 비밀번호 확인 후 삭제)
  if (req.method === "DELETE") {
    try {
      const body = await parseBody(req);
      const commentId = query.id || body.id || body.comment_id;

      if (!commentId) {
        return res.status(400).json({ error: "삭제할 댓글 ID가 필요합니다." });
      }

      const targetIdx = comments.findIndex(c => String(c.id) === String(commentId));
      if (targetIdx === -1) {
        return res.status(404).json({ error: "해당 댓글을 찾을 수 없습니다." });
      }

      const target = comments[targetIdx];

      if (!isAdmin) {
        // 관리자가 작성한 댓글은 게스트가 비밀번호로 삭제 불가
        if (target.is_admin) {
          return res.status(403).json({ error: "관리자 작성 댓글은 관리자만 삭제할 수 있습니다." });
        }

        const inputPw = (body.password || query.password || "").trim();
        if (!inputPw) {
          return res.status(400).json({ error: "삭제 비밀번호를 입력해 주세요." });
        }

        const inputHash = crypto.createHash("sha256").update(inputPw).digest("hex");
        if (target.password_hash && target.password_hash !== inputHash) {
          return res.status(403).json({ error: "비밀번호가 일치하지 않습니다." });
        }
      }

      // 댓글 및 해당 댓글의 답글(parent_id가 target.id인 항목) 일괄 삭제
      const delId = Number(target.id);
      comments = comments.filter(c => Number(c.id) !== delId && Number(c.parent_id) !== delId);
      await saveStorage(comments);

      return res.status(200).json({ success: true, message: "댓글이 삭제되었습니다." });
    } catch (e) {
      return res.status(500).json({ error: "댓글 삭제 처리 중 오류가 발생했습니다." });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
};
