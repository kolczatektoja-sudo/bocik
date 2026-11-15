# Prywatny rejestr transakcji New Shop

Kanał docelowy: `1571279387137933322`, serwer `1350446732365926491`.
Stan i kolejka wysyłki: osobny wiersz `bot_state.id=6`, `kind=transaction-audit-v1`.
Nie korzysta z licznika legit checków jako dowodu zakupu i nie zmienia wydatków klientów.

## Aktualny widok kanału

Jeden panel aktualizowany w miejscu oraz załączniki CSV/JSON, bez wiadomości dla każdej transakcji.
ID `1305200545979437129` to właściciel: jego historyczne rekordy trafiają do osobnego pliku wewnętrznego, nie do CSV klientów.
JSON zawiera także kopię wcześniejszych kart audytu z tego kanału. Nie zmienia źródłowych legit checków.
`transaction-audit-settings.json.cleanupLegacy` domyślnie jest wyłączone. Wolno je włączyć wyłącznie po zgodzie użytkownika na usunięcie starych kart audytu z logi2.
Usuwanie sprawdza jednocześnie: dokładny kanał logi2, autora będącego tym botem, starą stopkę audytu, zapisany identyfikator i wcześniejsze dostarczenie kopii JSON.

## Bieżące zdarzenia

- `/ticket-zakoncz`: zapis zgłoszenia realizacji przez obsługę, z użytkownikiem i obsługą z ticketu.
- Pasujący `+rep` klienta: osobny wpis potwierdzenia z linkiem do oryginalnej wiadomości.
- Anonimowe zamknięcie istniejącego ticketu: zapis prawdziwego ID właściciela ticketu i osoby zamykającej, mimo anonimizacji publicznego LC.
- Kolejne etapy jednego zakupu mają wspólne ID transakcji. Nie należy sumować ich kwot jako osobnych zakupów.
- Testy, nagrody, zerowe kwoty i automatycznie generowane LC nie trafiają do rejestru.

## Import historii

Uruchamia się automatycznie i zachowuje postęp po restarcie.

1. Odczytuje `user_purchases` dla tego serwera.
2. Czyta historię kanału `1449840030947217529`. Importuje tylko wiadomości rzeczywistych użytkowników zgodne z rekordem bazy: to samo ID, kwota, rodzaj, serwer i data w przedziale do 7 dni.
3. Czyta kanał archiwum ticketów wskazany przez `getLogiTicketChannel`. Z archiwów tekstowych odzyskuje właściciela i parametry transakcji. Wymaga rozpoznanego automatycznego zamknięcia po +rep lub anonimowym LC oraz jednoznacznych parametrów transakcji. Jeśli znajduje zgodny rekord bazy, dodaje powiązanie; jeśli nie, jawnie opisuje brak dopasowanego rekordu bazy. Tożsamość musi zawsze pochodzić z nagłówka rzeczywistego ticketu.
4. Botowe/webhookowe wpisy +rep bez powiązanego archiwum nie stanowią źródła tożsamości. Nie zgaduje klienta na podstawie samej kwoty.
5. W rejestrze zachowuje datę źródłową, datę importu, identyfikatory źródeł i SHA-256 odczytanego transkryptu, jeśli był użyty.
6. Po dopasowaniu zachowanych wiadomości importuje pozostałe historyczne rekordy `user_purchases` sprzed uruchomienia importu. Ta tabela jest zapisywana przez `/ticket-zakoncz`, a nie przez generator auto LC. Przy brakującym powiązaniu z wiadomością pokazuje źródło jako rekord bazy i nie dopowiada sprzedawcy ani potwierdzenia wpłaty. Kluczem jest ID rekordu, więc nie dubluje dopasowanych wcześniej zakupów. Nie importuje tą drogą nowych zakupów obsłużonych już przez bieżący rejestr.

Import używa wyłącznie odczytu wiadomości źródłowych. Nie wywołuje ich edycji, usuwania, ponownego publikowania ani istniejącego handlera `messageCreate`.

## Granice danych

Rejestr dokumentuje zdarzenia i deklaracje zapisane w Discordzie/bazie. Sam nie weryfikuje przelewów, otrzymania pieniędzy ani daty płatności. Brakujące pola są jawnie oznaczone. Nie wszystkie anonimowe LC da się odzyskać: usunięte lub niezapisane dane pozostają nieznane.

## Ochrona i diagnostyka

- Wysyła dane wyłącznie do wskazanego kanału tego serwera i odmawia publikacji, jeśli `@everyone` ma dostęp do kanału.
- `allowedMentions.parse=[]`: nie powiadamia użytkowników.
- Nie nadpisuje niezwiązanego wiersza bazy. Nie zapisuje pustego stanu po błędzie odczytu.
- Zapisuje wpis przed wysłaniem. Restart i ponowienie nie powinny tworzyć podwójnych kart; identyfikuje karty po stopce.
- Każde żądanie importu/publikacji jest rozłożone w czasie i respektuje lokalną przerwę po HTTP 429.
- `/health` pokazuje jedynie liczniki i postęp importu w `transaction_audit`, bez danych klientów i kwot.
- `history.*.excluded` oznacza wszystkie niezaimportowane wiadomości, również instrukcje i duplikaty. To nie jest liczba fake LC.
- Nie usuwać wiersza 6 ani jego wpisów przy resetowaniu licznika LC. Wiersze 1–4 należą do innych funkcji.

Testy: `node --test tests/transaction-audit.test.cjs`, pełny zestaw: `npm test`.
