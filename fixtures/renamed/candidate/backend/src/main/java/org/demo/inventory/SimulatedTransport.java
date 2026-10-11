package org.demo.inventory;

import org.legacy.clients.RawHttpClient;

// This fixture's exemption is simulated; it is not a real human approval.
public class SimulatedTransport {
    private final RawHttpClient client;

    public SimulatedTransport(RawHttpClient client) {
        this.client = client;
    }
}
