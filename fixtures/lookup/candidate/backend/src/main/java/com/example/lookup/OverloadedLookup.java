package com.example.lookup;

public class OverloadedLookup {
    public String resolve(String id) {
        return id;
    }

    public String resolve(Integer id) {
        return String.valueOf(id);
    }
}
