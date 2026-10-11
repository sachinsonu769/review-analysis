package qa;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
class TemplateResource {
 @GetMapping("/catalog/{id}") String get() { return "v1"; }
 @GetMapping("/catalog/{id}/details") String details() { return "v1"; }
 @GetMapping("/numbers/{id:[0-9]+}") String constrained() { return "v1"; }
}