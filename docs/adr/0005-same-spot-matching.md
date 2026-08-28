# ADR 0005: Same-spot-only matching

Status: accepted

Filter candidates to the exact surf spot before deterministic weighted ranking. Cross-spot similarity is not an MVP claim because orientation, bathymetry, access, and local effects differ. Return component differences for debugging; do not use ML weights yet.

For partial provider data, `availableWeight` is the weight of numeric features present on the target and `matchedWeight` is the subset also present on a candidate. `coverage = matchedWeight / availableWeight`; candidates below 0.5 coverage do not enter ranked results. The weighted similarity index is calculated only across matched features and is shown separately from coverage, not as a probability.
