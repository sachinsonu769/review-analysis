package com.example.lookup;

import org.legacy.clients.RawHttpClient;
import org.springframework.stereotype.Service;

@Service
public class LookupService {
    private final RawHttpClient client;

    public LookupService(RawHttpClient client) {
        this.client = client;
    }

    public LookupResponse lookup(String id) {
        return new LookupResponse(id, client.getLabel(id));
    }
}
