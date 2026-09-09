# @raportkrs/sdk

Klient TypeScript/JavaScript publicznego API [RaportKRS](https://api.raportkrs.pl/docs). Zero zależności, Node ≥ 18 / Deno / Bun / przeglądarka.

```bash
npm i @raportkrs/sdk
```

```ts
import { RaportKRS } from "@raportkrs/sdk";

const api = new RaportKRS(process.env.RAPORTKRS_KEY!);   // klucz z https://raportkrs.pl/panel/api

// jedna firma (+ finanse w tym samym żądaniu)
const { dane: firma, tokeny } = await api.firma("nip:5252973880", { dolacz: ["finanse"] });
console.log(firma.nazwa, firma.finanse?.[0]?.rachunek_zyskow_i_strat.przychody, "saldo:", tokeny.saldo);

// masowo — 500 NIP-ów w jednym żądaniu, płacisz tylko za znalezione
const wyniki = await api.batch(listaNipow.map((n) => `nip:${n}`));

// katalog: spółki IT z Mazowsza z przychodami > 10 mln, wszystkie strony
for await (const f of api.firmyWszystkie({ wojewodztwo: "MAZOWIECKIE", pkd_dzial: "62", przychody_od: 10_000_000 })) {
  console.log(f.krs, f.nazwa, f.ostatnie_sprawozdanie?.przychody);
}

// zdarzenia od wczoraj (zmiany statusu + MSiG), z kursorem
for await (const z of api.zdarzeniaWszystkie({ od: "2026-08-27" })) console.log(z.typ, z.firma.nazwa);

// webhook zamiast pollingu
const { dane: wh } = await api.utworzWebhook({ url: "https://moja-apka.pl/hook", zdarzenia: ["zmiana_statusu"], filtry: { krs: ["0000123456"] } });
console.log("sekret (pokazany raz):", wh.sekret);
```

Weryfikacja podpisu dostawy webhooka:

```ts
import { weryfikujPodpis } from "@raportkrs/sdk";
const ok = await weryfikujPodpis(SEKRET, req.headers["x-raportkrs-timestamp"], rawBody, req.headers["x-raportkrs-signature"]);
```

ETag (0 tokenów, gdy dane bez zmian):

```ts
const r1 = await api.firma("0000123456");
const r2 = await api.firma("0000123456", { ifNoneMatch: r1.etag });
r2.bezZmian; // true → r2.dane === null, koszt 0
```

Błędy: `RaportKRSError` z polami `status`, `kod` (`bledny_parametr`, `brak_tokenow`, `limit_zapytan`, `nie_znaleziono`, …), `requestId`, `retryAfter`. 429 i 5xx ponawiane automatycznie (`ponowienia`, domyślnie 2).

Dokumentacja: https://api.raportkrs.pl/docs · Markdown dla agentów: https://api.raportkrs.pl/docs.md · Regulamin: https://raportkrs.pl/regulamin-api
