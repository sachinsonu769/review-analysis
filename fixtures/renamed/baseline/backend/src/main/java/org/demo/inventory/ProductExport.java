package org.demo.inventory;

public class ProductExport {
    private final InventoryResolver service;

    public ProductExport(InventoryResolver service) {
        this.service = service;
    }

    public ProductReply export(String id) {
        return service.resolveInventory(id);
    }
}
