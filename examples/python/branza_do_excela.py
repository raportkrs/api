"""Wszystkie spółki działu PKD z województwa -> plik Excel/CSV.

Pobiera katalog stronami (1 token za stronę do 1 000 rekordów) i zapisuje
płaską tabelę do CSV zdatnego dla polskiego Excela.

    pip install raportkrs
    export RAPORTKRS_KEY=rk_live_...
    python branza_do_excela.py
"""
import csv
import os

from raportkrs import RaportKRS

api = RaportKRS(os.environ["RAPORTKRS_KEY"])

wiersze = []
for f in api.firmy_wszystkie(wojewodztwo="POMORSKIE", pkd_dzial="62", przychody_od=1_000_000):
    ost = f.get("ostatnie_sprawozdanie") or {}
    wiersze.append({
        "krs": f["krs"],
        "nazwa": f["nazwa"],
        "miasto": f.get("miasto"),
        "rok": ost.get("rok"),
        "przychody": ost.get("przychody"),
        "wynik_netto": ost.get("wynik_netto"),
    })

with open("firmy.csv", "w", newline="", encoding="utf-8-sig") as fh:
    w = csv.DictWriter(fh, fieldnames=wiersze[0].keys(), delimiter=";")
    w.writeheader()
    w.writerows(wiersze)

print(f"Zapisano {len(wiersze)} spółek do firmy.csv")
