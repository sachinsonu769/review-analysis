package com.example.lookup;

public class RetiredLookupAdapter {
    private final LookupService service;

    public RetiredLookupAdapter(LookupService service) {
        this.service = service;
    }

    public LookupResponse lookupOld(String id) {
        return service.lookup(id);
    }
}
