package org.demo.inventory;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class InventoryResource {
    private final InventoryResolver service;

    public InventoryResource(InventoryResolver service) {
        this.service = service;
    }

    @GetMapping("/warehouse/resolve")
    public ProductReply resolveInventory(@RequestParam(defaultValue = "current") String id) {
        return service.resolveInventory(new InventoryInquiry(id));
    }
}
