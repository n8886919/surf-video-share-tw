# ADR 0004: Condition provider abstraction

Status: accepted

Normalize marine/tide data behind provider interfaces and store provenance with every snapshot. Provider/model changes must not silently rewrite historical observations. A fixed mock exists only for explicit development mode.
