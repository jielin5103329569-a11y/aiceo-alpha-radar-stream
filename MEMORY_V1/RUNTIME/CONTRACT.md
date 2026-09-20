# Runtime bridge contract
Status: SPEC ONLY. Not implemented. productionAuthority stays false.

Allowed later (needs Owner + Agent write):
- Read MEMORY_V1/BOTTLENECK/WELLS.yaml
- Read MEMORY_V1/STATE/alpha.current.yaml
- Read EXTERNAL_EYES/PACKS/ as frozen discovery only

Forbidden now and later unless Owner re-authorizes:
- Write alertReady / live-5 / scores
- Eyes pack body rewrite
- 8080 restart as unstick
- Databento / PA / Resume changes
- Auto ticker from pack section B

First implementable slice when Owner says 接线:
Research sidecar reader. Output well id + class + NOT CONFIRMED. No trade path.
