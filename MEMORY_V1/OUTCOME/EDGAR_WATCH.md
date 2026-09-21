# Later-filing watch (paper)

Gap filled: pack / later-price / later-8K.
Not a plugin. Not wired to 8080. Not live-5.

Official search:
https://www.sec.gov/edgar/search/

Company browse (replace CIK):
https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810&type=8-K&dateb=&owner=include&count=10

Grok duty on each new PACK and each US session close:
1. Keep FILINGS.yaml last_8k=UNKNOWN until a real 8-K accession is read.
2. Only fill when the filing names the already-open well or mirror constraint.
3. Hit/miss stays waiting until that fill.
4. Do not scrape full-market EDGAR into alerts.
