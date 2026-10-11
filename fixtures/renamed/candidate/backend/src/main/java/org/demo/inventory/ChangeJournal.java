package org.demo.inventory;

import org.legacy.clients.RawHttpClient;

// Newly introduced architecture violation; no reviewed exemption exists.
public class ChangeJournal {
    private final RawHttpClient client;

    public ChangeJournal(RawHttpClient client) {
        this.client = client;
    }
}
