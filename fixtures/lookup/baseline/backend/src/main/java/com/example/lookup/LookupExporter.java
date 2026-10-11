package com.example.lookup;

public class LookupExporter {
    private final LookupService service;

    public LookupExporter(LookupService service) {
        this.service = service;
    }

    public LookupResponse export(String id) {
        return service.lookup(id);
    }
}
