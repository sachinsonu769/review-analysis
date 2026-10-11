package com.example.lookup;

import org.legacy.clients.RawHttpClient;

// Newly introduced architecture violation; no reviewed exemption exists.
public class AuditLogger {
    private final RawHttpClient client;

    public AuditLogger(RawHttpClient client) {
        this.client = client;
    }
}
