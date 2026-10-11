package org.demo.inventory;

import org.springframework.stereotype.Component;

@Component
public class InventoryRefreshTask {
    private final InventoryResolver service;

    public InventoryRefreshTask(InventoryResolver service) {
        this.service = service;
    }

    public ProductReply run(String id) {
        return service.resolveInventory(id);
    }
}
