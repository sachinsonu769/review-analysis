# Simulated exception evidence — test data only

This document is a test fixture. It is **not** a human approval, a production
review, or evidence that any real owner agreed to an exception.

The synthetic current exception for `ApprovedLegacyGateway.java` (or the renamed
`SimulatedTransport.java`) exercises a reviewed status with a future expiry.
Its JSON approval explicitly sets `simulation: true`, so reports must describe
the exemption as simulated.

The synthetic exception for `ExpiredGateway.java` (or `ExpiredTransport.java`)
expired on 2026-01-01 and must not suppress the violation at the fixture analysis
date. `UnreviewedGateway.java` (or `ProposedTransport.java`) has only a proposed
exception, which must remain unreviewed and ineffective.

All examples marked `proposed` are unreviewed candidates for guidance. Their
presence in a repository does not establish them as an approved pattern.
