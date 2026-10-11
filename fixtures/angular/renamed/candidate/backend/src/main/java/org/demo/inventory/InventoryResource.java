package org.demo.inventory;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class InventoryResource {
    @GetMapping("/warehouse/resolve")
    public ProductReply resolveInventory(@RequestParam String id) {
        return new ProductReply(id, "Current product");
    }
}
