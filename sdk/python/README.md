# raportkrs

Klient Pythona publicznego API [RaportKRS](https://api.raportkrs.pl/docs). Bez zależności, Python ≥ 3.9.

```bash
pip install raportkrs
```

```python
from raportkrs import RaportKRS, RaportKRSError

api = RaportKRS("rk_live_...")            # klucz z https://raportkrs.pl/panel/api

# jedna firma (+ finanse w tym samym żądaniu)
r = api.firma("nip:5252973880", dolacz=["finanse"])
print(r.dane["nazwa"], r.dane["finanse"][0]["rachunek_zyskow_i_strat"]["przychody"], "saldo:", r.tokeny["saldo"])

# masowo — 500 NIP-ów w jednym żądaniu, płacisz tylko za znalezione
wyniki = api.batch(f"nip:{n}" for n in lista_nipow)
for w in wyniki:
    print(w["identyfikator"], w["firma"]["nazwa"] if w["firma"] else w["blad"]["kod"])

# katalog: spółki IT z Mazowsza z przychodami > 10 mln — wszystkie strony (1 token/stronę)
for f in api.firmy_wszystkie(wojewodztwo="MAZOWIECKIE", pkd_dzial="62", przychody_od=10_000_000):
    print(f["krs"], f["nazwa"], f["ostatnie_sprawozdanie"]["przychody"])

# pandas
import pandas as pd
df = pd.DataFrame(api.firmy(wojewodztwo="POMORSKIE", pkd_dzial="41", limit=1000).dane)

# zdarzenia od wczoraj, z kursorem
for z in api.zdarzenia_wszystkie(od="2026-08-27"):
    print(z["typ"], z["data"], z["firma"]["nazwa"])

# webhook zamiast pollingu
wh = api.utworz_webhook("https://moja-apka.pl/hook", zdarzenia=["zmiana_statusu"], filtry={"krs": ["0000123456"]})
print("sekret (pokazany raz):", wh.dane["sekret"])
```

Weryfikacja podpisu dostawy (Flask/FastAPI — użyj surowego body):

```python
from raportkrs import weryfikuj_podpis
ok = weryfikuj_podpis(SEKRET, request.headers["X-RaportKRS-Timestamp"], request.get_data(), request.headers["X-RaportKRS-Signature"])
```

ETag (0 tokenów, gdy dane bez zmian): `r2 = api.firma("0000123456", if_none_match=r1.etag); r2.bez_zmian`.

Błędy: `RaportKRSError` z `status`, `kod`, `szczegoly`, `request_id`, `retry_after`. 429 i 5xx ponawiane automatycznie (`ponowienia=2`).

Dokumentacja: https://api.raportkrs.pl/docs · Regulamin: https://raportkrs.pl/regulamin-api
