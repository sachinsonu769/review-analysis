package com.example.lookup;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class LookupController {
    @GetMapping("/lookup")
    public LookupResponse lookup(@RequestParam String id) {
        return new LookupResponse(id, "Current lookup");
    }
}
