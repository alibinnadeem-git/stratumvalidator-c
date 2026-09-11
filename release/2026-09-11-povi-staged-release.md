# STRATUM Validator C — PoVI staged release

Release date: 2026-09-11

This marker triggers deployment of the already merged and CI-validated POVI-P0-COMPAT/1 engine to the Validator C production service. It does not activate PoVI as the default public finality path. Legacy production behavior remains unchanged while the staged `/stratum/povi/v1/records` and peer VERIFY/COMMIT surfaces are validated across Validators A, B, and C.
