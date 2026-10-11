package org.demo.inventory;

import org.legacy.clients.RawHttpClient;
import org.springframework.stereotype.Service;

@Service
public class InventoryResolver {
    private final RawHttpClient client;

    public InventoryResolver(RawHttpClient client) {
        this.client = client;
    }

    public ProductReply resolveInventory(String id) {
        return new ProductReply(id, client.readTitle(id));
    }
}
