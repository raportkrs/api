# Przykłady curl

Klucz z https://raportkrs.pl/panel/api — ustaw raz:

```bash
export RAPORTKRS_KEY="rk_live_TWOJ_KLUCZ"
```

## Jedna firma z finansami i organami (2 tokeny + 2 za dołączenia)

```bash
curl -s -H "Authorization: Bearer $RAPORTKRS_KEY" \
  "https://api.raportkrs.pl/v1/firmy/0000028860?dolacz=finanse,osoby" | jq '.dane.nazwa, .dane.finanse[0].rachunek_zyskow_i_strat.przychody'
```

## Szukaj po NIP

```bash
curl -s -H "Authorization: Bearer $RAPORTKRS_KEY" \
  "https://api.raportkrs.pl/v1/firmy/szukaj?q=5252973880" | jq '.dane[] | {krs, nazwa}'
```

## Katalog: spółki IT z Mazowsza z przychodami powyżej 10 mln (1 token za stronę)

```bash
curl -s -H "Authorization: Bearer $RAPORTKRS_KEY" \
  "https://api.raportkrs.pl/v1/firmy?wojewodztwo=MAZOWIECKIE&pkd_dzial=62&przychody_od=10000000&limit=100" | jq '.meta, (.dane | length)'
```

## Masowo do CSV (arkusz z listą NIP-ów)

```bash
curl -s -X POST \
  -H "Authorization: Bearer $RAPORTKRS_KEY" -H "Content-Type: application/json" \
  -d '{"identyfikatory":["0000028860","nip:5252973880"],"dolacz":["finanse"]}' \
  "https://api.raportkrs.pl/v1/firmy/batch?format=csv" -o firmy.csv
```

## ETag — odpytywanie bez zużywania tokenów, gdy nic się nie zmieniło

```bash
ETAG=$(curl -sI -H "Authorization: Bearer $RAPORTKRS_KEY" \
  "https://api.raportkrs.pl/v1/firmy/0000028860" | tr -d '\r' | awk -F': ' '/^etag/I {print $2}')

curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $RAPORTKRS_KEY" -H "If-None-Match: $ETAG" \
  "https://api.raportkrs.pl/v1/firmy/0000028860"   # 304 = bez naliczenia
```

## Webhook: powiadom mnie o każdej zmianie statusu w dziale PKD 41 (budownictwo)

```bash
curl -s -X POST \
  -H "Authorization: Bearer $RAPORTKRS_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://twoj-serwer.pl/webhook","zdarzenia":["zmiana_statusu"],"filtry":{"pkd_dzial":"41"}}' \
  "https://api.raportkrs.pl/v1/webhooki"
```

## Stan tokenów (bezpłatne)

```bash
curl -s -H "Authorization: Bearer $RAPORTKRS_KEY" "https://api.raportkrs.pl/v1/konto/zuzycie" | jq
```
