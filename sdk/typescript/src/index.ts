/**
 * @raportkrs/sdk — klient publicznego API RaportKRS.
 * Zero zależności; działa w Node ≥18, Deno, Bun, przeglądarce i Apps Script (po transpilacji).
 *
 *   import { RaportKRS } from "@raportkrs/sdk";
 *   const api = new RaportKRS(process.env.RAPORTKRS_KEY!);
 *   const firma = await api.firma("0000123456", { dolacz: ["finanse"] });
 */

export interface KlientOpcje {
  /** Adres bazowy (domyślnie https://api.raportkrs.pl). */
  baseUrl?: string;
  /** Własny fetch (np. do testów). */
  fetch?: typeof fetch;
  /** Automatyczne ponowienia przy 429/5xx (domyślnie 2). */
  ponowienia?: number;
  /** Timeout żądania w ms (domyślnie 30 000). */
  timeoutMs?: number;
}

export interface Meta {
  koszt: number;
  wygenerowano: string;
  [k: string]: unknown;
}

export interface Odpowiedz<T> {
  dane: T;
  meta: Meta;
  /** Nagłówki rozliczeniowe. */
  tokeny: { saldo: number | null; abonament: number | null; koszt: number | null };
  etag: string | null;
  requestId: string | null;
  /** true gdy serwer zwrócił 304 (dane z `ifNoneMatch` aktualne; `dane` = null). */
  bezZmian: boolean;
}

export class RaportKRSError extends Error {
  constructor(
    public status: number,
    public kod: string,
    message: string,
    public szczegoly?: unknown,
    public requestId?: string | null,
    public retryAfter?: number | null,
  ) {
    super(message);
    this.name = "RaportKRSError";
  }
}

export type Sekcja = "finanse" | "osoby" | "wlasciciele" | "powiazania" | "zdarzenia" | "dokumenty";
export type TypZdarzenia = "zmiana_statusu" | "ogloszenie_msig";
export type ZdarzenieWebhooka = "zmiana_statusu" | "ogloszenie_msig" | "nowe_sprawozdanie";

export interface FirmaSkrot {
  krs: string; nip: string | null; regon: string | null; nazwa: string; forma_prawna: string | null;
  status: string | null; miasto: string | null; wojewodztwo: string | null; pkd_glowne: string | null; profil_url: string;
}
export interface FirmaKatalog extends FirmaSkrot {
  powiat: string | null; kod_pocztowy: string | null; pkd_opis: string | null; kapital_zakladowy: number | null;
  ostatnie_sprawozdanie: { rok: number; przychody: number | null; zysk_netto: number | null; aktywa_razem: number | null; kapital_wlasny: number | null; roa: number | null; roe: number | null; wzrost_przychodow_rr: number | null } | null;
}
export interface Sprawozdanie {
  rok: number; skonsolidowane: boolean; data_zlozenia: string | null; zrodlo: string | null;
  rachunek_zyskow_i_strat: Record<string, number | null>;
  bilans: Record<string, number | null>;
  zatrudnienie: number | null;
  wskazniki: Record<string, number | null>;
}
export interface Firma extends Record<string, unknown> {
  krs: string; nip: string | null; regon: string | null; nazwa: string; status: string | null; forma_prawna: string | null;
  adres: Record<string, string | null>; profil_url: string;
  finanse?: Sprawozdanie[]; osoby?: unknown[]; wlasciciele?: unknown; powiazania?: unknown; zdarzenia?: unknown[]; dokumenty?: unknown[];
}
export interface WynikBatch { identyfikator: string; firma: Firma | null; blad: { kod: string; komunikat: string; szczegoly?: unknown } | null }
export interface Zdarzenie extends Record<string, unknown> { typ: TypZdarzenia; data: string; firma: FirmaSkrot }
export interface Webhook {
  id: string; url: string; zdarzenia: string[]; filtry: Record<string, string[]>; opis: string | null; aktywny: boolean;
  zrodlo: string; sekret_prefiks: string; nieudane_z_rzedu: number; ostatnia_dostawa: string | null; ostatni_status: number | null;
  powod_wylaczenia: string | null; utworzono: string; sekret?: string;
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

export class RaportKRS {
  private readonly baseUrl: string;
  private readonly f: typeof fetch;
  private readonly ponowienia: number;
  private readonly timeoutMs: number;

  constructor(private readonly klucz: string, opcje: KlientOpcje = {}) {
    if (!klucz || !klucz.startsWith("rk_live_")) throw new Error("Podaj klucz API w formacie rk_live_… (panel: https://raportkrs.pl/panel/api)");
    this.baseUrl = (opcje.baseUrl ?? "https://api.raportkrs.pl").replace(/\/$/, "");
    this.f = opcje.fetch ?? globalThis.fetch;
    this.ponowienia = opcje.ponowienia ?? 2;
    this.timeoutMs = opcje.timeoutMs ?? 30_000;
  }

  // ── Firmy ─────────────────────────────────────────────────────────

  /** Katalog z filtrami (co najmniej jeden filtr). Zwraca stronę + meta.razem / meta.nastepny_offset. */
  firmy(filtry: Query) { return this.get<FirmaKatalog[]>("/v1/firmy", filtry); }

  /** Wszystkie strony katalogu jako async iterator (uwaga: każda strona = 1 token). */
  async *firmyWszystkie(filtry: Query, limit = 1000): AsyncGenerator<FirmaKatalog> {
    let offset = 0;
    for (;;) {
      const r = await this.firmy({ ...filtry, limit, offset });
      for (const f of r.dane) yield f;
      const next = r.meta.nastepny_offset as number | null;
      if (next === null || next === undefined || r.dane.length === 0) return;
      offset = next;
    }
  }

  szukaj(q: string, limit = 25) { return this.get<FirmaSkrot[]>("/v1/firmy/szukaj", { q, limit }); }

  /** Firma po KRS albo `nip:XXXXXXXXXX`. `ifNoneMatch` = ETag z poprzedniej odpowiedzi (304 → bezZmian, 0 tokenów). */
  firma(id: string, opcje: { dolacz?: Sekcja[]; historia?: boolean; ifNoneMatch?: string | null } = {}) {
    return this.get<Firma>(`/v1/firmy/${enc(id)}`, { dolacz: opcje.dolacz, historia: opcje.historia ? "tak" : undefined }, opcje.ifNoneMatch);
  }

  /** Do 500 firm w jednym żądaniu; automatycznie dzieli większe listy na partie. */
  async batch(identyfikatory: string[], opcje: { dolacz?: Sekcja[] } = {}): Promise<WynikBatch[]> {
    const out: WynikBatch[] = [];
    for (let i = 0; i < identyfikatory.length; i += 500) {
      const r = await this.post<WynikBatch[]>("/v1/firmy/batch", { identyfikatory: identyfikatory.slice(i, i + 500), dolacz: opcje.dolacz });
      out.push(...r.dane);
    }
    return out;
  }

  finanse(id: string) { return this.get<Sprawozdanie[]>(`/v1/firmy/${enc(id)}/finanse`); }
  branza(id: string) { return this.get<unknown>(`/v1/firmy/${enc(id)}/branza`); }
  osoby(id: string, historia = false) { return this.get<unknown[]>(`/v1/firmy/${enc(id)}/osoby`, { historia: historia ? "tak" : undefined }); }
  wlasciciele(id: string) { return this.get<unknown>(`/v1/firmy/${enc(id)}/wlasciciele`); }
  powiazania(id: string) { return this.get<unknown>(`/v1/firmy/${enc(id)}/powiazania`); }
  zdarzeniaFirmy(id: string) { return this.get<unknown[]>(`/v1/firmy/${enc(id)}/zdarzenia`); }
  dokumenty(id: string) { return this.get<unknown[]>(`/v1/firmy/${enc(id)}/dokumenty`); }

  osoba(osobaId: string) { return this.get<unknown>(`/v1/osoby/${enc(osobaId)}`); }
  osobaPowiazania(osobaId: string) { return this.get<unknown[]>(`/v1/osoby/${enc(osobaId)}/powiazania`); }

  // ── Zdarzenia i webhooki ─────────────────────────────────────────

  /** Strona strumienia zdarzeń; kolejna strona przez `kursor: r.meta.nastepny_kursor`. */
  zdarzenia(filtry: { typ?: TypZdarzenia[]; od?: string; do?: string; nowy_status?: string[]; rodzaj?: string[]; wojewodztwo?: string[]; pkd_dzial?: string[]; limit?: number; kursor?: string | null } = {}) {
    return this.get<Zdarzenie[]>("/v1/zdarzenia", filtry as Query);
  }

  /** Iteruje po wszystkich zdarzeniach od `od` (każda strona = 1 token). */
  async *zdarzeniaWszystkie(filtry: Parameters<RaportKRS["zdarzenia"]>[0] = {}): AsyncGenerator<Zdarzenie> {
    let kursor: string | null | undefined = filtry.kursor;
    for (;;) {
      const r = await this.zdarzenia({ ...filtry, limit: filtry.limit ?? 1000, kursor });
      for (const z of r.dane) yield z;
      kursor = r.meta.nastepny_kursor as string | null;
      if (!kursor) return;
    }
  }

  webhooki() { return this.get<Webhook[]>("/v1/webhooki"); }
  utworzWebhook(dane: { url: string; zdarzenia?: ZdarzenieWebhooka[]; filtry?: Record<string, string[]>; opis?: string }) { return this.post<Webhook>("/v1/webhooki", dane); }
  usunWebhook(id: string) { return this.request<{ usunieto: boolean }>("DELETE", `/v1/webhooki/${enc(id)}`); }
  testujWebhook(id: string) { return this.post<{ zakolejkowano: boolean }>(`/v1/webhooki/${enc(id)}/test`, {}); }

  zuzycie(miesiac?: string) { return this.get<unknown>("/v1/konto/zuzycie", { miesiac }); }

  // ── HTTP ──────────────────────────────────────────────────────────

  get<T>(path: string, query: Query = {}, ifNoneMatch?: string | null) { return this.request<T>("GET", path, query, undefined, ifNoneMatch); }
  post<T>(path: string, body: unknown, query: Query = {}) { return this.request<T>("POST", path, query, body); }

  async request<T>(method: string, path: string, query: Query = {}, body?: unknown, ifNoneMatch?: string | null): Promise<Odpowiedz<T>> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${this.klucz}`, Accept: "application/json", "User-Agent": "raportkrs-sdk-js/1.1.0" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;

    let attempt = 0;
    for (;;) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.f(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
      } catch (e) {
        clearTimeout(t);
        if (attempt++ < this.ponowienia) { await sleep(500 * attempt); continue; }
        throw e;
      }
      clearTimeout(t);
      const num = (h: string) => { const v = res.headers.get(h); return v === null ? null : Number(v); };
      const base = { tokeny: { saldo: num("X-Tokeny-Saldo"), abonament: num("X-Tokeny-Abonament"), koszt: num("X-Koszt") }, etag: res.headers.get("ETag"), requestId: res.headers.get("X-Request-Id") };

      if (res.status === 304) return { dane: null as unknown as T, meta: { koszt: 0, wygenerowano: new Date().toISOString() }, ...base, bezZmian: true };
      if ((res.status === 429 || res.status >= 500) && attempt++ < this.ponowienia) {
        const ra = Number(res.headers.get("Retry-After") ?? 0);
        await sleep(res.status === 429 ? Math.max(ra, 1) * 1000 : 500 * attempt);
        continue;
      }
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const b = json?.blad ?? {};
        throw new RaportKRSError(res.status, b.kod ?? "blad", b.komunikat ?? `HTTP ${res.status}`, b.szczegoly, b.request_id ?? base.requestId, num("Retry-After"));
      }
      return { dane: json.dane as T, meta: json.meta ?? { koszt: 0, wygenerowano: "" }, ...base, bezZmian: false };
    }
  }
}

/** Weryfikacja podpisu webhooka (Node / Deno / Bun z Web Crypto). */
export async function weryfikujPodpis(sekret: string, timestamp: string, body: string, podpis: string, maxWiekSek = 300): Promise<boolean> {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > maxWiekSek) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(sekret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = "sha256=" + Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== podpis.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ podpis.charCodeAt(i);
  return diff === 0;
}

const enc = (s: string) => encodeURIComponent(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
