package org.demo.inventory;

public class RetiredInventoryAdapter {
    private final InventoryResolver service;

    public RetiredInventoryAdapter(InventoryResolver service) {
        this.service = service;
    }

    public ProductReply resolveOld(String id) {
        return service.resolveInventory(id);
    }
}
