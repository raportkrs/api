// Szybka weryfikacja kontrahenta po NIP.
//
//   git clone https://github.com/raportkrs/api && npm i ./api/sdk/typescript
//   RAPORTKRS_KEY=rk_live_... node sprawdz-kontrahenta.mjs 5252973880

import { RaportKRS, RaportKRSError } from "@raportkrs/sdk";

const nip = process.argv[2] ?? "5252973880";
const api = new RaportKRS(process.env.RAPORTKRS_KEY);

try {
  const { dane: f, tokeny } = await api.firma(`nip:${nip}`, { dolacz: ["finanse"] });
  console.log(`${f.nazwa} · KRS ${f.krs} · status: ${f.status}`);
  const ost = f.finanse?.[0];
  if (ost) {
    const r = ost.rachunek_zyskow_i_strat;
    console.log(`Rok ${ost.rok}: przychody ${r.przychody?.toLocaleString("pl-PL")} zł, wynik netto ${r.wynik_netto?.toLocaleString("pl-PL")} zł`);
  } else {
    console.log("Brak złożonych sprawozdań finansowych.");
  }
  console.log(`Pozostałe tokeny: ${tokeny.saldo}`);
} catch (e) {
  if (e instanceof RaportKRSError) {
    console.error(`Błąd ${e.status} (${e.kod}): ${e.message}`);
    process.exit(1);
  }
  throw e;
}
