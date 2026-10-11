package com.example.lookup;

import org.legacy.clients.RawHttpClient;
import org.springframework.stereotype.Service;

@Service
public class LookupService {
    private final RawHttpClient client;

    public LookupService(RawHttpClient client) {
        this.client = client;
    }

    public LookupResponse lookup(LookupQuery query) {
        return new LookupResponse(query.id(), client.getLabel(query.id()));
    }
}
