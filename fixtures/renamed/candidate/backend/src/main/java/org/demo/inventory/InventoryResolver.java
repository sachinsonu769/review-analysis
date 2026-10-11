package org.demo.inventory;

import org.legacy.clients.RawHttpClient;
import org.springframework.stereotype.Service;

@Service
public class InventoryResolver {
    private final RawHttpClient client;

    public InventoryResolver(RawHttpClient client) {
        this.client = client;
    }

    public ProductReply resolveInventory(InventoryInquiry query) {
        return new ProductReply(query.id(), client.readTitle(query.id()));
    }
}
