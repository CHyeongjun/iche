const crypto = require("crypto");

/**
 * Vercel Serverless Function: Admin Authentication
 * Endpoint: /api/auth
 */

async function parseBody(req) {
  if (req.body) {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body);
      } catch (e) {
        return {};
      }
    }
    return req.body;
  }
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

module.exports = async function handler(req, res) {
  // CORS & Security headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const ADMIN_PASS = process.env.ADMIN_PASSWORD || "1234";

  function generateAdminToken(password) {
    const secret = process.env.TOKEN_SECRET || "vibe_record_hub_super_secret_2026";
    return crypto.createHmac("sha256", secret).update(`admin:${password}`).digest("hex");
  }

  if (req.method === "POST") {
    try {
      const body = await parseBody(req);
      const password = (body.password || "").trim();

      if (!password) {
        return res.status(400).json({ error: "비밀번호를 입력해 주세요." });
      }

      if (password === ADMIN_PASS) {
        const token = generateAdminToken(password);
        return res.status(200).json({
          success: true,
          token: token,
          isAdmin: true,
          message: "관리자로 성공적으로 로그인되었습니다."
        });
      } else {
        return res.status(401).json({
          success: false,
          error: "비밀번호가 올바르지 않습니다."
        });
      }
    } catch (err) {
      return res.status(500).json({ error: "인증 처리 중 오류가 발생했습니다." });
    }
  }

  if (req.method === "GET") {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const expectedToken = generateAdminToken(ADMIN_PASS);

    if (token && token === expectedToken) {
      return res.status(200).json({ isAdmin: true });
    }
    return res.status(200).json({ isAdmin: false });
  }

  return res.status(405).json({ error: "허용되지 않은 메서드입니다." });
};
