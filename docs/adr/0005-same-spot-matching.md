# ADR 0005: Same-spot-only matching

Status: accepted

Filter candidates to the exact surf spot before deterministic weighted ranking. Cross-spot similarity is not an MVP claim because orientation, bathymetry, access, and local effects differ. Return component differences for debugging; do not use ML weights yet.

For partial provider data, `availableWeight` is the weight of numeric features present on the target and `matchedWeight` is the subset also present on a candidate. `coverage = matchedWeight / availableWeight`; candidates below 0.5 coverage do not enter ranked results. The weighted similarity index is calculated only across matched features and is shown separately from coverage, not as a probability.

The public composite ranker requires both CWA `cwa-wave-f-a0020-001` and Open-Meteo `ecmwf_wam`. Each provider is normalized and filtered by the same coverage rule independently, then the two source scores receive equal 50% weight. This is a hierarchy over source scores, not an average of raw fields or immutable feature rows. Missing either target or historical source excludes the video from the ranked list.
