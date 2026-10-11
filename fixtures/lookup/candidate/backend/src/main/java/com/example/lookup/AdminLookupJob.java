package com.example.lookup;

import org.springframework.stereotype.Component;

@Component
public class AdminLookupJob {
    private final LookupService service;

    public AdminLookupJob(LookupService service) {
        this.service = service;
    }

    public LookupResponse run(String id) {
        return service.lookup(id);
    }
}
