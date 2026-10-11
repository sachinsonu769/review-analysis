package com.example.lookup;

import org.legacy.clients.RawHttpClient;

// This fixture's exemption is simulated; it is not a real human approval.
public class ApprovedLegacyGateway {
    private final RawHttpClient client;

    public ApprovedLegacyGateway(RawHttpClient client) {
        this.client = client;
    }
}
