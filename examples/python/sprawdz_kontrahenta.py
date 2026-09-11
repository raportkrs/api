"""Szybka weryfikacja kontrahenta po NIP.

Uruchomienie:
    pip install raportkrs
    export RAPORTKRS_KEY=rk_live_...
    python sprawdz_kontrahenta.py 5252973880
"""
import os
import sys

from raportkrs import RaportKRS, RaportKRSError

nip = sys.argv[1] if len(sys.argv) > 1 else "5252973880"
api = RaportKRS(os.environ["RAPORTKRS_KEY"])

try:
    r = api.firma(f"nip:{nip}", dolacz=["finanse", "osoby"])
except RaportKRSError as e:
    print(f"Błąd {e.status} ({e.kod}): {e.komunikat}")
    sys.exit(1)

f = r.dane
print(f"{f['nazwa']}  ·  KRS {f['krs']}  ·  status: {f['status']}")

sprawozdania = f.get("finanse") or []
if sprawozdania:
    ost = sprawozdania[0]
    rzis = ost["rachunek_zyskow_i_strat"]
    print(f"Rok {ost['rok']}: przychody {rzis['przychody']:,.0f} zł, "
          f"wynik netto {rzis['wynik_netto']:,.0f} zł")
else:
    print("Brak złożonych sprawozdań finansowych.")

zarzad = [o for o in (f.get("osoby") or []) if o.get("rola") == "zarzad"]
if zarzad:
    print("Zarząd:", ", ".join(o["imie_nazwisko"] for o in zarzad))

print(f"Pozostałe tokeny: {r.tokeny['saldo']}")
