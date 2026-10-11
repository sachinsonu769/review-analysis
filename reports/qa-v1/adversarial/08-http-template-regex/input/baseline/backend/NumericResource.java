package qa;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
class NumericResource {
 @GetMapping("/numeric/{id:[0-9]+}") String numeric() { return "v1"; }
}