# RaportKRS API

Programistyczny dostęp do danych o polskich spółkach z KRS: dane rejestrowe, sprawozdania finansowe ze wskaźnikami, organy i wspólnicy, beneficjenci rzeczywiści (CRBR), powiązania kapitałowe i osobowe, ogłoszenia MSiG oraz strumień zdarzeń rejestrowych.

* Dokumentacja interaktywna: **https://api.raportkrs.pl/docs**
* OpenAPI: https://api.raportkrs.pl/openapi.json (import do Postmana/Insomni)
* Dokumentacja dla LLM: https://api.raportkrs.pl/llms.txt
* Klucz API i 100 tokenów testowych bez karty: https://raportkrs.pl/panel/api
* Cennik: https://raportkrs.pl/cennik · Regulamin: https://raportkrs.pl/regulamin-api · Metodologia danych: https://raportkrs.pl/metodologia

## Szybki start

```bash
curl -H "Authorization: Bearer rk_live_TWOJ_KLUCZ" \
  "https://api.raportkrs.pl/v1/firmy/0000028860?dolacz=finanse,osoby"
```

Wyszukiwanie po nazwie / NIP / KRS / REGON:

```bash
curl -H "Authorization: Bearer rk_live_TWOJ_KLUCZ" \
  "https://api.raportkrs.pl/v1/firmy/szukaj?q=orlen"
```

Masowo — do 500 identyfikatorów w jednym żądaniu, wynik także jako CSV:

```bash
curl -X POST \
  -H "Authorization: Bearer rk_live_TWOJ_KLUCZ" -H "Content-Type: application/json" \
  -d '{"identyfikatory":["0000028860","nip:5252973880"],"dolacz":["finanse"]}' \
  "https://api.raportkrs.pl/v1/firmy/batch?format=csv"
```

## SDK

Kod obu klientów w katalogu [`sdk/`](sdk/):

| Język | Pakiet | Instalacja |
|---|---|---|
| Python ≥ 3.9 (bez zależności) | [`sdk/python`](sdk/python) | `pip install raportkrs` — a do czasu publikacji w PyPI: `pip install "git+https://github.com/raportkrs/api#subdirectory=sdk/python"` |
| TypeScript / JS (Node ≥ 18, Deno, Bun, przeglądarka) | [`sdk/typescript`](sdk/typescript) | `npm i @raportkrs/sdk` |

```python
from raportkrs import RaportKRS

api = RaportKRS("rk_live_TWOJ_KLUCZ")
r = api.firma("nip:5252973880", dolacz=["finanse"])
print(r.dane["nazwa"], r.dane["finanse"][0]["rachunek_zyskow_i_strat"]["przychody"])
```

```ts
import { RaportKRS } from "@raportkrs/sdk";

const api = new RaportKRS(process.env.RAPORTKRS_KEY!);
const { dane } = await api.firma("0000028860", { dolacz: ["finanse"] });
console.log(dane.nazwa);
```

Więcej w [`examples/`](examples/): [Python](examples/python) · [Node](examples/node) · [curl](examples/curl.md).

## Endpointy (v1)

| Endpoint | Opis |
|---|---|
| `GET /v1/firmy` | Katalog firm z filtrami (lokalizacja, PKD, status, dane finansowe); strona do 1 000 rekordów |
| `GET /v1/firmy/szukaj` | Szukaj po nazwie / NIP / KRS / REGON |
| `GET /v1/firmy/{id}` | Dane rejestrowe spółki (`{id}` = KRS, `nip:…` lub `regon:…`) |
| `GET /v1/firmy/{id}/finanse` | Sprawozdania finansowe (wszystkie lata) + wskaźniki |
| `GET /v1/firmy/{id}/branza` | Pozycja na tle branży (dział PKD × województwo) |
| `GET /v1/firmy/{id}/osoby` | Organy: zarząd, rada, prokurenci, wspólnicy, likwidatorzy |
| `GET /v1/firmy/{id}/wlasciciele` | Struktura właścicielska + beneficjenci rzeczywiści (CRBR) |
| `GET /v1/firmy/{id}/powiazania` | Spółki powiązane przez osoby i kapitał |
| `GET /v1/firmy/{id}/zdarzenia` | Zmiany statusu (dział 6) i ogłoszenia MSiG z pełną treścią |
| `GET /v1/firmy/{id}/dokumenty` | Lista złożonych dokumentów finansowych |
| `POST /v1/firmy/batch` | Masowe pobranie do 500 firm (KRS/NIP) |
| `GET /v1/osoby/{id}` · `GET /v1/osoby/{id}/powiazania` | Profile osób i ich funkcje w spółkach |
| `GET /v1/zdarzenia` | Strumień zdarzeń z całej bazy |
| `GET/POST/DELETE /v1/webhooki` | Subskrypcje zdarzeń (podpis HMAC-SHA256), dostawy bezpłatne |
| `GET /v1/konto/zuzycie` | Stan tokenów (bezpłatne) |

Pełne parametry i schematy odpowiedzi: https://api.raportkrs.pl/docs

## Zasady, które warto znać

* **Uwierzytelnianie**: `Authorization: Bearer rk_live_…` (albo `X-Api-Key`). Klucz trzymaj w zmiennej środowiskowej — przykłady w tym repo czytają `RAPORTKRS_KEY`.
* **Rozliczanie w tokenach**: płacisz tylko za żądania `200` z niepustymi danymi (zwykle 1 token; każda sekcja `dolacz=` +1). Błędy, `404` i puste wyniki są bezpłatne. Saldo w nagłówkach `X-Tokeny-Saldo` / `X-Tokeny-Abonament`.
* **ETag**: każda odpowiedź ma `ETag`; żądanie z `If-None-Match` przy niezmienionych danych zwraca `304` **bez naliczenia tokenów**.
* **Limity**: 120 żądań/min na klucz (`429` + `Retry-After`).
* **CSV**: listy także jako CSV — `?format=csv` lub `Accept: text/csv` (UTF-8 z BOM, `separator=;` pod polskiego Excela).
* **Webhooki zamiast odpytywania**: subskrybuj zmiany statusu, nowe ogłoszenia MSiG i nowe sprawozdania z filtrami po KRS / województwie / dziale PKD.
* **Konwencje**: JSON UTF-8, koperta `{ dane, meta }`, błąd w `{ blad }`, kwoty w PLN, procenty jako ułamki, daty ISO 8601. Dodawanie pól nie jest zmianą łamiącą.
* **Dane osobowe**: endpointy z zakresem `osoby` zwracają imiona i nazwiska z KRS/CRBR (bez PESEL i dat urodzenia); odbiorca staje się odrębnym administratorem — zob. [regulamin API](https://raportkrs.pl/regulamin-api).

## English

REST API for Polish company registry (KRS) data: registry records, yearly financial statements with ratios, management boards and shareholders, ultimate beneficial owners (CRBR), company networks, court gazette (MSiG) announcements and a registry event stream. Interactive docs (Polish field names, English-friendly structure): https://api.raportkrs.pl/docs · OpenAPI: https://api.raportkrs.pl/openapi.json. Free trial: 100 tokens, no card required — https://raportkrs.pl/panel/api

## Licencja

Kod w tym repozytorium (SDK i przykłady): [MIT](LICENSE). Korzystanie z API i danych: [regulamin API](https://raportkrs.pl/regulamin-api).
