package example.customers;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

// Illustrative test source. No build configuration or execution record is supplied.
class CustomerLookupControllerTest {
    @Test
    void lookupByIdReturnsMatchingCustomer() {
        var response = new CustomerLookupController().lookup("customer-1");
        assertEquals("customer-1", response.id());
    }

    @Test
    void returnsDisplayName() {
        var response = new CustomerLookupController().lookup("customer-1");
        assertEquals("Ada Example", response.displayName());
    }
}
