// Odbiór webhooków RaportKRS z weryfikacją podpisu HMAC-SHA256.
//
// 1. Uruchom serwer:            RAPORTKRS_WEBHOOK_SECRET=... node webhook-serwer.mjs
// 2. Zarejestruj webhook:       POST /v1/webhooki  (sekret dostaniesz w odpowiedzi)
// 3. Wyślij zdarzenie testowe:  POST /v1/webhooki/{id}/test

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.RAPORTKRS_WEBHOOK_SECRET;
const MAX_WIEK_SEK = 300;

createServer((req, res) => {
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const ts = req.headers["x-raportkrs-timestamp"];
    const podpis = req.headers["x-raportkrs-signature"];
    const oczekiwany = "sha256=" + createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
    const swiezy = Math.abs(Date.now() / 1000 - Number(ts)) < MAX_WIEK_SEK;
    const zgodny = podpis?.length === oczekiwany.length &&
      timingSafeEqual(Buffer.from(podpis), Buffer.from(oczekiwany));

    if (!swiezy || !zgodny) { res.writeHead(401).end(); return; }

    const zdarzenie = JSON.parse(body);
    console.log(`[${req.headers["x-raportkrs-event"]}] ${zdarzenie.dane?.krs ?? ""} ${zdarzenie.dane?.nazwa ?? ""}`);
    res.writeHead(200).end("ok");
  });
}).listen(8080, () => console.log("Nasłuchuję na :8080"));
