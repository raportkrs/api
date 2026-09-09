"""
raportkrs — klient publicznego API RaportKRS (https://api.raportkrs.pl/docs).

Zero zależności (urllib). Python ≥ 3.9.

    from raportkrs import RaportKRS
    api = RaportKRS("rk_live_...")
    firma = api.firma("nip:5252973880", dolacz=["finanse"])
    print(firma.dane["nazwa"], firma.tokeny["saldo"])
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Iterable, Iterator, Optional, Sequence

__all__ = ["RaportKRS", "RaportKRSError", "Odpowiedz", "weryfikuj_podpis"]
__version__ = "1.1.0"

_SEKCJE = ("finanse", "osoby", "wlasciciele", "powiazania", "zdarzenia", "dokumenty")


class RaportKRSError(Exception):
    """Błąd API: `status` (HTTP), `kod` (np. brak_tokenow, limit_zapytan, nie_znaleziono), `szczegoly`, `request_id`."""

    def __init__(self, status: int, kod: str, komunikat: str, szczegoly: Any = None, request_id: Optional[str] = None, retry_after: Optional[int] = None):
        super().__init__(f"[{status} {kod}] {komunikat}")
        self.status, self.kod, self.komunikat, self.szczegoly, self.request_id, self.retry_after = status, kod, komunikat, szczegoly, request_id, retry_after


@dataclass
class Odpowiedz:
    dane: Any
    meta: dict = field(default_factory=dict)
    tokeny: dict = field(default_factory=dict)      # saldo, abonament, koszt
    etag: Optional[str] = None
    request_id: Optional[str] = None
    bez_zmian: bool = False                         # True przy 304 (dane = None, 0 tokenów)


class RaportKRS:
    def __init__(self, klucz: str, base_url: str = "https://api.raportkrs.pl", ponowienia: int = 2, timeout: float = 30.0):
        if not klucz or not klucz.startswith("rk_live_"):
            raise ValueError("Podaj klucz API w formacie rk_live_… (panel: https://raportkrs.pl/panel/api)")
        self._klucz = klucz
        self._base = base_url.rstrip("/")
        self._ponowienia = ponowienia
        self._timeout = timeout

    # ── Firmy ─────────────────────────────────────────────────────────

    def firmy(self, **filtry: Any) -> Odpowiedz:
        """Katalog z filtrami (co najmniej jeden). Strona = 1 token; `meta['nastepny_offset']` → kolejna strona."""
        return self.get("/v1/firmy", filtry)

    def firmy_wszystkie(self, limit: int = 1000, **filtry: Any) -> Iterator[dict]:
        offset = 0
        while True:
            r = self.firmy(limit=limit, offset=offset, **filtry)
            yield from r.dane
            nxt = r.meta.get("nastepny_offset")
            if nxt is None or not r.dane:
                return
            offset = nxt

    def szukaj(self, q: str, limit: int = 25) -> Odpowiedz:
        return self.get("/v1/firmy/szukaj", {"q": q, "limit": limit})

    def firma(self, id: str, dolacz: Optional[Sequence[str]] = None, historia: bool = False, if_none_match: Optional[str] = None) -> Odpowiedz:
        """Firma po KRS albo `nip:XXXXXXXXXX`. `if_none_match` = ETag z poprzedniej odpowiedzi (304 → bez_zmian, 0 tokenów)."""
        return self.get(f"/v1/firmy/{_enc(id)}", {"dolacz": dolacz, "historia": "tak" if historia else None}, if_none_match=if_none_match)

    def batch(self, identyfikatory: Iterable[str], dolacz: Optional[Sequence[str]] = None) -> list[dict]:
        """Do 500 firm w jednym żądaniu; większe listy dzielone automatycznie. Płacisz tylko za znalezione."""
        ids = list(identyfikatory)
        out: list[dict] = []
        for i in range(0, len(ids), 500):
            r = self.post("/v1/firmy/batch", {"identyfikatory": ids[i:i + 500], "dolacz": list(dolacz) if dolacz else None})
            out.extend(r.dane)
        return out

    def finanse(self, id: str) -> Odpowiedz: return self.get(f"/v1/firmy/{_enc(id)}/finanse")
    def branza(self, id: str) -> Odpowiedz: return self.get(f"/v1/firmy/{_enc(id)}/branza")
    def osoby(self, id: str, historia: bool = False) -> Odpowiedz: return self.get(f"/v1/firmy/{_enc(id)}/osoby", {"historia": "tak" if historia else None})
    def wlasciciele(self, id: str) -> Odpowiedz: return self.get(f"/v1/firmy/{_enc(id)}/wlasciciele")
    def powiazania(self, id: str) -> Odpowiedz: return self.get(f"/v1/firmy/{_enc(id)}/powiazania")
    def zdarzenia_firmy(self, id: str) -> Odpowiedz: return self.get(f"/v1/firmy/{_enc(id)}/zdarzenia")
    def dokumenty(self, id: str) -> Odpowiedz: return self.get(f"/v1/firmy/{_enc(id)}/dokumenty")
    def osoba(self, osoba_id: str) -> Odpowiedz: return self.get(f"/v1/osoby/{_enc(osoba_id)}")
    def osoba_powiazania(self, osoba_id: str) -> Odpowiedz: return self.get(f"/v1/osoby/{_enc(osoba_id)}/powiazania")

    # ── Zdarzenia i webhooki ─────────────────────────────────────────

    def zdarzenia(self, **filtry: Any) -> Odpowiedz:
        """typ, od, do, nowy_status, rodzaj, wojewodztwo, pkd_dzial, limit, kursor. Kolejna strona: kursor=r.meta['nastepny_kursor']."""
        return self.get("/v1/zdarzenia", filtry)

    def zdarzenia_wszystkie(self, **filtry: Any) -> Iterator[dict]:
        filtry.setdefault("limit", 1000)
        while True:
            r = self.zdarzenia(**filtry)
            yield from r.dane
            kursor = r.meta.get("nastepny_kursor")
            if not kursor:
                return
            filtry["kursor"] = kursor

    def webhooki(self) -> Odpowiedz: return self.get("/v1/webhooki")

    def utworz_webhook(self, url: str, zdarzenia: Optional[Sequence[str]] = None, filtry: Optional[dict] = None, opis: Optional[str] = None) -> Odpowiedz:
        """Zwraca webhook z polem `sekret` (pokazywany tylko raz)."""
        return self.post("/v1/webhooki", {"url": url, "zdarzenia": list(zdarzenia) if zdarzenia else None, "filtry": filtry, "opis": opis})

    def usun_webhook(self, id: str) -> Odpowiedz: return self.request("DELETE", f"/v1/webhooki/{_enc(id)}")
    def testuj_webhook(self, id: str) -> Odpowiedz: return self.post(f"/v1/webhooki/{_enc(id)}/test", {})
    def zuzycie(self, miesiac: Optional[str] = None) -> Odpowiedz: return self.get("/v1/konto/zuzycie", {"miesiac": miesiac})

    # ── HTTP ──────────────────────────────────────────────────────────

    def get(self, path: str, query: Optional[dict] = None, if_none_match: Optional[str] = None) -> Odpowiedz:
        return self.request("GET", path, query, None, if_none_match)

    def post(self, path: str, body: Any, query: Optional[dict] = None) -> Odpowiedz:
        return self.request("POST", path, query, body)

    def request(self, method: str, path: str, query: Optional[dict] = None, body: Any = None, if_none_match: Optional[str] = None) -> Odpowiedz:
        params = {k: (",".join(map(str, v)) if isinstance(v, (list, tuple)) else v) for k, v in (query or {}).items() if v not in (None, "", [])}
        url = self._base + path + ("?" + urllib.parse.urlencode(params) if params else "")
        headers = {"Authorization": f"Bearer {self._klucz}", "Accept": "application/json", "User-Agent": f"raportkrs-sdk-python/{__version__}"}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps({k: v for k, v in body.items() if v is not None} if isinstance(body, dict) else body).encode()
        if if_none_match:
            headers["If-None-Match"] = if_none_match

        attempt = 0
        while True:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=self._timeout) as res:
                    return self._parse(res.status, dict(res.headers), res.read())
            except urllib.error.HTTPError as e:
                status, hdrs, raw = e.code, dict(e.headers), e.read()
                if status == 304:
                    return self._parse(304, hdrs, b"")
                if status in (429,) or status >= 500:
                    if attempt < self._ponowienia:
                        attempt += 1
                        time.sleep(max(int(hdrs.get("Retry-After", "1") or 1), 1) if status == 429 else 0.5 * attempt)
                        continue
                return self._parse(status, hdrs, raw)
            except urllib.error.URLError:
                if attempt < self._ponowienia:
                    attempt += 1
                    time.sleep(0.5 * attempt)
                    continue
                raise

    @staticmethod
    def _parse(status: int, h: dict, raw: bytes) -> Odpowiedz:
        hl = {k.lower(): v for k, v in h.items()}
        num = lambda k: (int(hl[k]) if k in hl and hl[k].lstrip("-").isdigit() else None)
        tokeny = {"saldo": num("x-tokeny-saldo"), "abonament": num("x-tokeny-abonament"), "koszt": num("x-koszt")}
        base = dict(tokeny=tokeny, etag=hl.get("etag"), request_id=hl.get("x-request-id"))
        if status == 304:
            return Odpowiedz(dane=None, meta={"koszt": 0}, bez_zmian=True, **base)
        try:
            j = json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            j = {}
        if status >= 400:
            b = j.get("blad", {}) if isinstance(j, dict) else {}
            raise RaportKRSError(status, b.get("kod", "blad"), b.get("komunikat", f"HTTP {status}"), b.get("szczegoly"), b.get("request_id") or base["request_id"], num("retry-after"))
        return Odpowiedz(dane=j.get("dane"), meta=j.get("meta", {}), **base)


def weryfikuj_podpis(sekret: str, timestamp: str, body: bytes, podpis: str, max_wiek_sek: int = 300) -> bool:
    """Weryfikacja nagłówka X-RaportKRS-Signature dostawy webhooka."""
    try:
        if abs(time.time() - int(timestamp)) > max_wiek_sek:
            return False
    except ValueError:
        return False
    oczekiwany = "sha256=" + hmac.new(sekret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(oczekiwany, podpis)


def _enc(s: str) -> str:
    return urllib.parse.quote(str(s), safe="")
