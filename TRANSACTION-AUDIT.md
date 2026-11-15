# Prywatny rejestr transakcji New Shop

Kanał docelowy: `1571279387137933322`, serwer `1350446732365926491`.
Stan i kolejka wysyłki: osobny wiersz `bot_state.id=6`, `kind=transaction-audit-v1`.
Nie korzysta z licznika legit checków jako dowodu zakupu i nie zmienia wydatków klientów.

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
3. Czyta kanał archiwum ticketów wskazany przez `getLogiTicketChannel`. Z archiwów tekstowych odzyskuje właściciela, parametry transakcji i powiązanie z rekordem bazy. Wymaga rozpoznanego automatycznego zamknięcia po +rep lub anonimowym LC oraz jednoznacznych parametrów transakcji.
4. Botowe/webhookowe wpisy +rep bez powiązanego archiwum nie stanowią źródła tożsamości. Nie zgaduje klienta na podstawie samej kwoty.
5. W rejestrze zachowuje datę źródłową, datę importu, identyfikatory źródeł i SHA-256 odczytanego transkryptu, jeśli był użyty.

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
