package example.customers;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

// Demonstration source only; this fixture is not a built application.
@RestController
@RequestMapping("/api")
public class CustomerLookupController {
    @GetMapping("/customers/lookup")
    public CustomerResponse lookup(@RequestParam String id) {
        return new CustomerResponse(id, "Ada Example");
    }
}
