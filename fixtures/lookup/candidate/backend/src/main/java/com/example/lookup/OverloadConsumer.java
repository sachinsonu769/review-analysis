package com.example.lookup;

public class OverloadConsumer {
    private final OverloadedLookup dependency;

    public OverloadConsumer(OverloadedLookup dependency) {
        this.dependency = dependency;
    }

    public String render() {
        // Intentionally ambiguous: both overloads accept null.
        return dependency.resolve(null);
    }
}
