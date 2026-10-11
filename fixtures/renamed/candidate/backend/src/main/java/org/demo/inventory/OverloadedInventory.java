package org.demo.inventory;

public class OverloadedInventory {
    public String resolve(String id) {
        return id;
    }

    public String resolve(Integer id) {
        return String.valueOf(id);
    }
}
