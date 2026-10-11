package org.demo.inventory;

public class ResolutionConsumer {
    private final OverloadedInventory dependency;

    public ResolutionConsumer(OverloadedInventory dependency) {
        this.dependency = dependency;
    }

    public String render() {
        // Intentionally ambiguous: both overloads accept null.
        return dependency.resolve(null);
    }
}
